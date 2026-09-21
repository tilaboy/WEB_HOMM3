import type { GameState, GridPos, Hero, PlayerId } from '../core/types.js';
import { ARTIFACTS, ARTIFACT_SLOTS } from '../core/data/artifacts.js';
import { WAR_MACHINES } from '../core/data/warmachines.js';
import { getUnit } from '../core/data/units.js';
import { factionColor, factionIds, factionName } from '../core/data/factions.js';
import { isRevealed } from '../core/map/fog.js';
import { effectivePrimary, expToNext, manaMaxOf, maxMovePoints } from '../core/game/hero.js';
import { factionStanding } from '../core/game/victory.js';
import { SCENARIO_BY_ID } from '../core/data/scenarios.js';
import { ownedMines } from '../core/game/town.js';

/** 面板永远是人类玩家 p1 的视角（迷雾、城池列表都按这个来）。 */
const VIEWER: PlayerId = 'p1';

/* §14.2 教学清单的两条阈值（数值权威 = `playtest-scenarios.md`，此处只引用、不复制理由）。
 * 140 ≠ 60：`revealed` 是**定长 0/1 掩码**（长度恒 = w×h = 576），开局两视野圆并集约 82 ——
 * 用 `.length >= 60` 会**开局即真**（假守卫）。140 ≈ 全图 24% ⇒ 前 1 分钟自然达成、但不可能开局即完成。 */
const WALK_MIN = 140;
/** ③ 阈值 = 2：教学场保证主城旁有木石矿（`playtest-scenarios.md §2.2 / §2.6 V3`）。 */
const MINE_MIN = 2;

export interface TownHooks {
  /** 把镜头移到该据点 */
  onLocate: (townId: string) => void;
  /** 打开城镇管理面板（己方城镇可远程管理） */
  onOpen: (townId: string) => void;
}

/**
 * D-1「面板内分段」的段键（`#156`）。**段 ≤ 4、默认段 = 部队**（最常用）。
 * 现行 spec（`#156` description）：段 = {部队 / 属性 / 城池 / 势力}；`army` **进分段**、
 * `bars` **并入 `head`**（不占独立行）、`hp-towns` 一行摘要。
 */
type SegKey = 'army' | 'attr' | 'town' | 'faction';

/**
 * 右侧查看器（HOMM3 布局）。
 *
 * ★ `#156`（D-1「面板内分段」，`in-game-ia.md §3.3`）—— 面板 = **常驻核 + 分段**：
 *   · **常驻核** = `head`（等级/经验并一行） + `bars`（移动力/法力**并一行**） + `army` ≈ 239 ≤ 240；
 *   · **分段** = 属性 / 城池 / 势力（**tab 条**、默认 = 属性）⇒ **常驻态与每个分段都 ≤240、永不滚动**。
 *   · tab 控件**复用既有 `segment` 控件语言**（`.ss-seg` / `.ss-seg-item`），**不新造第二套**。
 * 判据（可引用）：**英雄栏只放「这一个英雄」的属性**；玩家级 / 全局级信息不属于它。
 */
export class HeroPanel {
  /** 宝物格默认收起，避免占掉一屏里最贵的空间。 */
  private showArtifacts = false;
  /** 记住上一次的入参，折叠宝物时才能就地重画而不惊动镜头。 */
  private lastState: GameState | null = null;
  private lastHero: string | null = null;
  /** D-1「面板内分段」当前段。`#156` 终版（team-lead）：**默认段统一 = 部队、任何场景不例外**。 */
  private seg: SegKey = 'army';
  /** §14.2 教学清单锁存：一旦达成即保持（英雄阵亡后 `heroes['hero1']` 消失也不倒退）。 */
  private objLatch: Record<string, boolean> = {};
  /** 锁存属于哪一局（`state` 对象身份）：换局 / 载档即重播种，不把上一局进度带过来。 */
  private objState: GameState | null = null;
  /** 本局是否已用「现值」播种过：载入即 3/3 不算"达成转移" ⇒ 不弹 banner（§14.2 边缘情况 1）。 */
  private objSeeded = false;
  /** §14.2「完成那一刻」的非阻断 banner 只触发一次（会话内一次性）。 */
  private objBannerFired = false;
  /** 上一次渲染时是否已全达成（含"载入即全达成"）—— 用来识别"由假变真"的那一次转移。 */
  private objHadAllDone = false;

  constructor(
    private el: HTMLElement,
    private onSelect?: (heroId: string) => void,
    private onTown?: TownHooks,
    private onSpellBook?: (heroId: string) => void,
    /** §14.2：3/3 时块末行「去对决场」（覆盖当前存档，调用方须先确认）。 */
    private onGoDuel?: () => void,
    /** §14.2「完成那一刻」：教学清单**由未全达成 → 全达成**的那一次回调（非阻断 banner）。
     *  **会话内一次性**；载入即 3/3 **不算**"转移" ⇒ 不触发（边缘情况 1）。 */
    private onObjectivesComplete?: () => void,
  ) {
    // 调试：?devarts=1 直接展开宝物格（与 devbattle 同一套调试约定）
    this.showArtifacts = new URLSearchParams(location.search).has('devarts');
  }

  update(state: GameState, heroId: string | null): void {
    this.lastState = state;
    this.lastHero = heroId;
    this.el.innerHTML = '';

    // 教学清单锁存按"局"重置：新局 / 载档都会换 `state` 对象 ⇒ 换对象即重播种。
    if (state !== this.objState) {
      this.objState = state;
      this.objLatch = {};
      this.objSeeded = false;
      this.objBannerFired = false;
      this.objHadAllDone = false;
    }

    const hero = heroId ? state.heroes[heroId] : null;
    if (!hero) {
      // 英雄阵亡后清单仍在（② 靠锁存不倒退，§14.2 边缘情况 3）。
      const teach = this.objectiveSection(state);
      if (teach) this.el.appendChild(teach);
      const px = div('sec dim', '暂无可用英雄');
      this.el.appendChild(px);
      return;
    }

    // ★ 教学清单**每次都求值**（锁存 + "完成那一刻"banner 有副作用），**是否上屏由当前段决定**
    //   （`#156` 现行 spec：`teach` 是教学场的只读块 ⇒ 落在**「属性」段**；常驻核 = `head`(含 bars) + tab 条）。
    const teach = this.objectiveSection(state);

    /* --- 常驻核（D-1 现行 spec）= head（含 bars + 魔法书图标） + tab 条 --- */
    this.el.appendChild(this.headSection(state, hero));
    if (this.showArtifacts) this.el.appendChild(this.artifactSection(hero));

    /* --- 分段（{部队 / 属性 / 城池 / 势力}；默认 = 部队） --- */
    this.el.appendChild(this.segSection(state, hero, teach));
  }

  /* ---------------- 分段（D-1；tab 条复用 `.ss-seg` 控件语言） ---------------- */

  private segSection(state: GameState, hero: Hero, teach: HTMLElement | null): HTMLElement {
    const wrap = div('hp-seg');

    const tabs = div('ss-seg hp-tabs');
    tabs.setAttribute('role', 'radiogroup');
    const items: [SegKey, string][] = [
      ['army', '部队'],
      ['attr', '属性'],
      ['town', '城池'],
      ['faction', '势力'],
    ];
    for (const [key, label] of items) {
      const b = document.createElement('button');
      b.className = 'ss-seg-item hp-tab';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(this.seg === key));
      b.classList.toggle('on', this.seg === key);
      b.title = label;
      b.appendChild(span('t', label));
      b.addEventListener('click', () => {
        if (this.seg === key) return;
        this.seg = key;
        if (this.lastState) this.update(this.lastState, this.lastHero);
      });
      tabs.appendChild(b);
    }
    wrap.appendChild(tabs);

    const pane = div('hp-pane');
    if (this.seg === 'army') {
      pane.appendChild(this.armySection(hero));
    } else if (this.seg === 'attr') {
      if (teach) pane.appendChild(teach); // 教学场：只读教学清单，落在「属性」段
      pane.appendChild(this.statSection(hero));
    } else if (this.seg === 'town') {
      pane.appendChild(this.townSection(state, hero.id));
    } else {
      pane.appendChild(this.factionSection(state));
    }
    wrap.appendChild(pane);
    return wrap;
  }

  /* ---------------- 肖像 + 英雄切换 + 宝物开关 ---------------- */

  private headSection(state: GameState, hero: Hero): HTMLElement {
    const wrap = div('hp-head');

    const idx = state.heroOrder.indexOf(hero.id);
    const multi = state.heroOrder.length > 1;

    /* `#156` ★ 实测根因：`head` 行只有 184px 宽；`face`(40) + `hp-nav`(书 40 + 宝物 42 + gap 8 = 90)
     * + gap 8 ⇒ `hp-meta` 只剩 **~36px** ⇒「名」与「Lv.3 · 120/500」**各折 2–3 行** ⇒ `hp-head` = 119（>96）。
     * ⇒ 把 `宝物▾` 从 `nav` 挪到**肖像**上：**零宽度成本**，且仍是 **≥40×40 的真实可点目标**
     *   （`aria-expanded` + `aria-label` + `title`，不破 a11y），`meta` 回到 ~88px ⇒ 名与等级一行放下。 */
    const face = document.createElement('button');
    face.className = 'hp-face';
    face.textContent = hero.name.slice(0, 1);
    face.title = `${hero.name} · ${hero.heroClass}（点击${this.showArtifacts ? '收起' : '展开'}宝物格）`;
    face.setAttribute('aria-label', `${hero.name}，${this.showArtifacts ? '收起' : '展开'}宝物格`);
    face.setAttribute('aria-expanded', String(this.showArtifacts));
    face.style.borderColor = factionColor(hero.owner);
    face.addEventListener('click', () => {
      this.showArtifacts = !this.showArtifacts;
      if (this.lastState) this.update(this.lastState, this.lastHero);
    });
    wrap.appendChild(face);

    const meta = div('hp-meta');
    const line1 = div('hp-name');
    // `#156` / F-3.5：`经验 X / Y` 并入等级（全栏唯一真正的「同值多址」——`head` 已印 `Lv.N`）。
    // 副行（职业 · 第 N 周 N 日）删除：日期已在顶栏、职业与肖像/名同处 ⇒ 同值多址（§15.1 判据 2）。
    line1.append(
      span('', hero.name),
      span('hp-lv', `Lv.${hero.level} · ${hero.exp}/${expToNext(hero.level)}`),
    );
    // `#156` 现行 spec：移动力/法力**并入 head**（不占独立行）。
    const bars = div('hp-bars-row');
    const maxMp = maxMovePoints(hero, state);
    bars.appendChild(barRow('移动力', Math.floor(hero.movePoints), maxMp, hero.movePoints, ''));
    const maxMana = manaMaxOf(hero);
    bars.appendChild(barRow('法力', hero.mana, maxMana, hero.mana, 'mana'));
    meta.append(line1);
    wrap.appendChild(meta);

    const nav = div('hp-nav');
    // `#156` 现行 spec：`魔法书` 并入 head 行做图标按钮（触控沿用 `.btn.tiny` 的 ≥40px）。
    const spell = miniBtn('书', () => this.onSpellBook?.(hero.id), hero.spells.length ? '魔法书' : '还没学会任何法术（建魔法行会）');
    spell.classList.add('hp-spell');
    spell.disabled = !hero.spells.length;
    nav.appendChild(spell);
    if (multi) {
      const prev = miniBtn('‹', () => this.cycle(state, idx, -1), '上一位英雄');
      const next = miniBtn('›', () => this.cycle(state, idx, 1), '下一位英雄');
      nav.append(prev, next);
    }
    /* `#156` ★ 实测根因：`nav` 里同时放 `书` + `宝物` 两个 40px 按钮 ⇒ `meta` 被挤到 **~36px**
     * ⇒ 名 / 等级各换行成 3 行 ⇒ `hp-head` 涨到 **128**（实测）。
     * ⇒ 处置（与 `魔法书` 同口径「放不下就下沉到段内」）：**`宝物` 移到「部队」段首行**，
     *    `head` 只留 `书` 一个 ⇒ `meta` ≈88px，名与等级同行、不截断。 */
    wrap.appendChild(nav);

    /* `#156` ★ 实测根因修正：两条 bar 若留在 `meta` 里，就被同行右侧的 `hp-nav` 挤压
     * （`meta` 实测只剩 ~36px）⇒ 标签「移动力 12/12」换行成 2 行、名与等级各折 2–3 行
     * ⇒ `hp-head` 被撑到 **119**。⇒ 让 bar 行**独占一行全宽**（`flex-basis:100%`）：
     * 实测 `hp-head` 119 → **82**（≤96 ✓），`hp-bars-row` 46 → 29。 */
    wrap.appendChild(bars);

    return wrap;
  }

  private cycle(state: GameState, idx: number, delta: number): void {
    const n = state.heroOrder.length;
    if (n < 2) return;
    const next = state.heroOrder[(idx + delta + n) % n];
    if (next) this.onSelect?.(next);
  }

  /* ---------------- 属性（四维；`经验` 已并入 `head` 的 `Lv.N`） ---------------- */

  private statSection(hero: Hero): HTMLElement {
    const p = effectivePrimary(hero);
    const wrap = div('sec hp-stats');
    wrap.append(
      stat('攻', p.attack),
      stat('防', p.defense),
      stat('魔', p.spellPower),
      stat('知', p.knowledge),
    );
    return wrap;
  }

  /* ---------------- 部队格 ---------------- */

  private armySection(hero: Hero): HTMLElement {
    const wrap = div('sec hp-army');
    const h = document.createElement('h3');
    h.textContent = '部队';
    wrap.appendChild(h);

    /* `#156` ★ 收敛：`宝物` 开关**不在这里** —— 本段首行放一个 40px 按钮会给「部队」段加 ~44px，
     * 而「部队」是**默认段**（硬②：默认段下 `#side` 不滚）⇒ 自己给自己加负担。
     * 开关改挂**肖像**（`headSection` 的 `hp-face`）：零宽度、零高度、仍是 ≥40px 真实目标。
     * （本行以下若再需要"段内工具行"，请先量 `hpbudget` 的默认段预算。） */

    const grid = div('hp-slots');
    if (!hero.army.length) {
      grid.appendChild(div('hp-slot empty', '（无）'));
    }
    for (const s of hero.army) {
      const u = getUnit(s.unitTypeId);
      const cell = div('hp-slot');
      cell.title = `${u.name}：攻 ${u.attack} 防 ${u.defense} 伤 ${u.damageMin}-${u.damageMax} 血 ${u.hp} 速 ${u.speed}`;
      const dot = div('hp-dot');
      dot.style.background = u.body;
      const nm = div('hp-uname', u.name);
      const ct = div('hp-ucount', String(s.count));
      cell.append(dot, nm, ct);
      grid.appendChild(cell);
    }
    // 补足一行 4 格，视觉上才像 HOMM3 的兵种栏
    const filler = (4 - (hero.army.length % 4)) % 4;
    for (let i = 0; i < filler; i++) grid.appendChild(div('hp-slot blank'));

    wrap.appendChild(grid);
    return wrap;
  }

  /* ---------------- 宝物（可折叠） ---------------- */

  private artifactSection(hero: Hero): HTMLElement {
    const wrap = div('sec hp-arts');
    const grid = div('slot-row');
    for (const slot of ARTIFACT_SLOTS) {
      const owned = hero.artifacts.map((id) => ARTIFACTS[id]).find((a) => a && a.slot === slot.slot);
      const cell = div('slot' + (owned ? ' filled' : ''));
      cell.textContent = owned ? owned.name : slot.label;
      if (owned) cell.title = owned.desc;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    // 攻城器械：只在英雄确实带了的时候出现（工坊装配，见 TownDialog）
    const machines = hero.warMachines ?? [];
    if (machines.length) {
      const row = div('slot-row hp-machines');
      for (const id of machines) {
        const cell = div('slot filled machine');
        cell.textContent = WAR_MACHINES[id].name;
        cell.title = WAR_MACHINES[id].desc;
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ---------------- 教学清单（图一 objectives，§14.2；只读 GameState，零新系统） ---------------- */

  private objectiveSection(state: GameState): HTMLElement | null {
    // 渲染条件：只认教学场；自由对局 / 对决场不渲染（§14.2）。
    if (state.config.scenario !== 'tutorial') return null;
    const objs = SCENARIO_BY_ID['tutorial']?.objectives;
    if (!objs || !objs.length) return null;

    // 三条判定（§14.2 表，逐条已核源）；其中 ② 必须**锁存**（英雄阵亡后 hero1 会消失）。
    const live: Record<string, boolean> = {
      walk: revealedCount(state, VIEWER) >= WALK_MIN,
      firstwin: (state.heroes['hero1']?.exp ?? 0) > 0,
      mine: ownedMines(state, VIEWER).length >= MINE_MIN,
    };
    if (!this.objSeeded) {
      // 首次用「现值」播种：载入即 3/3 不算"由假变真" ⇒ 不弹 banner（边缘情况 1）。
      for (const o of objs) this.objLatch[o.id] = live[o.id] === true;
      this.objSeeded = true;
      // 播种即全达成（载入存档时已 3/3）⇒ 记为"已达成"，不算转移，不触发 banner。
      this.objHadAllDone = objs.every((o) => this.objLatch[o.id]);
    } else {
      for (const o of objs) if (live[o.id]) this.objLatch[o.id] = true; // 一旦达成即保持
    }
    const done = objs.filter((o) => this.objLatch[o.id]).length;

    // §14.2「完成那一刻」：**由未全达成 → 全达成**的那一次触发（会话内一次性；载入即 3/3 不弹）。
    const allDone = done === objs.length;
    if (allDone && !this.objHadAllDone && !this.objBannerFired) {
      this.objBannerFired = true;
      this.onObjectivesComplete?.();
    }
    this.objHadAllDone = allDone;

    const wrap = div('sec hp-teach');
    const h = document.createElement('h3');
    h.textContent = `教学 · 学会了吗 ${done}/${objs.length}`;
    wrap.appendChild(h);

    const list = div('hp-obj-list');
    list.setAttribute('role', 'list');
    for (const o of objs) {
      const got = this.objLatch[o.id] === true;
      const row = div('hp-obj-row' + (got ? ' done' : ''));
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', `${got ? '已学会' : '未学会'}：${o.text}`);
      const mark = span('hp-obj-mark', got ? '☑' : '☐');
      mark.setAttribute('aria-hidden', 'true'); // ☐/☑ 不是唯一语义载体（a11y 基线 §4.3）
      row.append(mark, span('hp-obj-text', o.text), span('hp-obj-flag', got ? '已学会' : '未学会'));
      list.appendChild(row);
    }
    wrap.appendChild(list);

    // 3/3 的**持久去处**：块末行「去对决场」（banner 关掉后仍可达，两个入口同一动作）。
    if (done === objs.length && this.onGoDuel) {
      const btn = document.createElement('button');
      btn.className = 'btn tiny hp-obj-go';
      btn.textContent = '去对决场';
      btn.title = '开一局对决场（会覆盖当前存档）';
      btn.addEventListener('click', () => this.onGoDuel?.());
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /* ---------------- 势力（多阵营对局里最该一眼看到的东西；`#156`：进分段） ---------------- */

  private factionSection(state: GameState): HTMLElement {
    const ids = factionIds(state);
    if (ids.length < 2) return div('sec hp-fac hidden');

    const wrap = div('sec hp-fac');
    const h = document.createElement('h3');
    h.textContent = '势力';
    wrap.appendChild(h);

    for (const id of ids) {
      const st = factionStanding(state, id);
      const row = div('hp-frow' + (st.alive ? '' : ' dead'));
      const dot = div('hp-fdot');
      dot.style.background = factionColor(id);
      const nm = div('hp-fname', id === VIEWER ? `${state.players[id]?.name ?? factionName(id)}（你）` : (state.players[id]?.name ?? factionName(id)));
      const meta = div('hp-fmeta', st.alive ? `${st.towns} 城 · ${st.heroes} 将` : '已出局');
      row.append(dot, nm, meta);
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* ---------------- 城池（`#156`：段内首行 = 一行摘要，明细在下） ---------------- */

  private townSection(state: GameState, heroId: string | null): HTMLElement {
    const wrap = div('sec hp-city');
    const hero = heroId ? state.heroes[heroId] : null;

    const known: (typeof state.towns)[string][] = [];
    let hidden = 0;
    for (const t of Object.values(state.towns)) {
      if (isRevealed(state, VIEWER, t.pos.x, t.pos.y)) known.push(t);
      else hidden += 1;
    }

    // ★ `#156` / team-lead 裁定：**一行摘要 = 段内首行**（**不是** tab 标签 —— tab 是导航、不是内容）。
    //   它保住"一句可扫读的规模感"，明细仍在本段下方（城镇面板另有专职入口）。
    const h = document.createElement('h3');
    h.className = 'hp-city-sum';
    h.textContent = hidden ? `城池 ${known.length} · 未发现 ${hidden}` : `城池 ${known.length}`;
    wrap.appendChild(h);

    if (!known.length) {
      wrap.appendChild(
        div('kv dim', hidden ? `继续探索，还有 ${hidden} 处未知的据点` : '地图上没有任何据点'),
      );
      return wrap;
    }

    const list = div('hp-city-list');
    known.sort((a, b) => (a.owner === VIEWER ? -1 : 1) - (b.owner === VIEWER ? -1 : 1));
    for (const t of known) {
      const mine = t.owner === VIEWER;
      const row = div('hp-crow');

      const dot = div('hp-ctdot' + (mine ? ' mine' : ''));
      if (!mine) dot.style.background = factionColor(t.owner);
      row.appendChild(dot);

      const nm = div('hp-ctname', t.name);
      row.appendChild(nm);

      const troops = t.garrison.reduce((s, st) => s + st.count, 0);
      const dist = hero ? manhattan(hero.pos, t.pos) : null;
      const meta = div('hp-ctmeta');
      meta.textContent = [
        mine ? '' : t.owner === 'neutral' ? '无主' : factionName(t.owner),
        troops ? `驻军 ${troops}` : '空城',
        dist !== null ? `${dist} 格` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      row.appendChild(meta);

      const btns = div('hp-ctbtns');
      if (mine) btns.appendChild(miniBtn('管理', () => this.onTown?.onOpen(t.id)));
      btns.appendChild(miniBtn('定位', () => this.onTown?.onLocate(t.id)));
      row.appendChild(btns);

      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }
}

/* ---------------- 小工具 ---------------- */

/** 已揭开的格数：`revealed` 是定长 0/1 掩码 ⇒ 必须数 1，**不能**取 `.length`（那恒 = 全图格数）。 */
function revealedCount(state: GameState, player: PlayerId): number {
  return state.players[player].revealed.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
}

function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function div(cls: string, text?: string): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function span(cls: string, text: string): HTMLElement {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  return e;
}

function miniBtn(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  // M-09：miniBtn 只用在 .hp-nav / .hp-tbtns 这两个"相邻仅 3px"的密集区，
  // 不能加 .tap（::after 会与邻钮命中区重叠）；靠 .btn.tiny 的真实 40px 兜底。
  b.className = 'btn tiny';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function stat(label: string, value: number): HTMLElement {
  const e = div('hp-stat');
  e.append(div('hp-stat-k', label), div('hp-stat-v', String(value)));
  return e;
}

function barRow(label: string, cur: number, max: number, raw: number, kind: string): HTMLElement {
  const row = div('hp-bar-row');
  const top = div('hp-bar-top');
  top.append(span('hp-bar-k', label), span('hp-bar-v', `${cur} / ${max}`));
  const bar = div('bar' + (kind ? ` ${kind}` : ''));
  const fill = document.createElement('i');
  fill.style.width = `${Math.max(0, Math.min(100, (raw / Math.max(1, max)) * 100))}%`;
  bar.appendChild(fill);
  row.append(top, bar);
  return row;
}
