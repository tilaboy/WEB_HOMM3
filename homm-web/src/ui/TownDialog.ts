import type { GameState, ResourceBag, ResourceKind } from '../core/types.js';
import { BUILDINGS, BUILDING_ORDER, HERO_HIRE_COST } from '../core/data/buildings.js';
import { WAR_MACHINES, WAR_MACHINE_IDS } from '../core/data/warmachines.js';
import { getUnit } from '../core/data/units.js';

/** 市场按钮上的短名（"木材"太长，挤不进小按钮）。 */
const RESOURCE_LABEL: Partial<Record<ResourceKind, string>> = {
  gold: '金', wood: '木', ore: '矿',
  gem: '宝石', crystal: '水晶', sulfur: '硫磺', mercury: '水银',
};
import {
  MARKET_RATES,
  build,
  buildStatus,
  canHireHero,
  costText,
  garrisonToHero,
  heroToGarrison,
  hireHero,
  marketBuy,
  marketSell,
  assembleWarMachine,
  canAssemble,
  heroWarMachines,
  recruitRows,
  recruitToGarrison,
  recruitToHero,
  townDailyIncome,
  townDefenseBonus,
  townGrowthMultiplier,
} from '../core/game/town.js';
import { showModal } from './Dialogs.js';

export interface TownDialogOptions {
  state: GameState;
  townId: string;
  /** 站在城里的英雄（可能为 null） */
  heroId: string | null;
  /** 任意状态变化后刷新外部 UI */
  onChange: () => void;
  /** 招募到新英雄时通知外部（用于选中 + 开视野） */
  onHire: (heroId: string) => void;
}

export function openTownDialog(parent: HTMLElement, opts: TownDialogOptions): void {
  const body = document.createElement('div');
  body.className = 'town';
  let note = '';
  const heroHere = opts.heroId ? opts.state.heroes[opts.heroId] : null;

  const render = (): void => {
    body.innerHTML = '';
    paint(body, opts, note, (m) => {
      note = m;
      render();
      opts.onChange();
    });
    opts.onChange();
  };

  render();

  const subtitle = heroHere
    ? `${heroHere.name} 在城中`
    : '远程管理：英雄不在城中，只能补充驻军';
  const wrap = document.createElement('div');
  const sub = document.createElement('div');
  sub.className = 'town-sub';
  sub.textContent = subtitle;
  wrap.appendChild(sub);
  wrap.appendChild(body);

  showModal(parent, {
    title: opts.state.towns[opts.townId]?.name ?? '城镇',
    body: [wrap],
    wide: true,
    actions: [{ label: '关闭', primary: true, onClick: (c) => c() }],
  });
}

type Say = (msg: string) => void;

function paint(root: HTMLElement, opts: TownDialogOptions, note: string, say: Say): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;
  const hero = opts.heroId ? state.heroes[opts.heroId] : null;
  const res = state.players.p1?.resources ?? {};
  const act = (fn: () => string | void): void => {
    const r = fn();
    say(typeof r === 'string' ? r : '');
  };

  /* 概览 */
  const head = document.createElement('div');
  head.className = 'town-head';
  head.appendChild(
    chip(`金币 ${res.gold ?? 0}`),
  );
  head.appendChild(chip(`木材 ${res.wood ?? 0}`));
  head.appendChild(chip(`矿石 ${res.ore ?? 0}`));
  head.appendChild(chip(`每日税收 ${townDailyIncome(town)}`));
  if (townDefenseBonus(town)) head.appendChild(chip(`城防 +${townDefenseBonus(town)}`));
  if (townGrowthMultiplier(town) > 1) {
    head.appendChild(chip(`周增长 ×${townGrowthMultiplier(town).toFixed(2)}`));
  }
  root.appendChild(head);

  if (note) {
    const n = document.createElement('div');
    n.className = 'town-note';
    n.textContent = note;
    root.appendChild(n);
  }

  /* 建筑 */
  const anySpent = BUILDING_ORDER.some((b) => buildStatus(state, town, b).spentToday);
  root.appendChild(sectionTitle(`建筑${anySpent ? '（今日已建造，明日可再建）' : ''}`));
  const grid = document.createElement('div');
  grid.className = 'bgrid';
  for (const id of BUILDING_ORDER) {
    const def = BUILDINGS[id];
    const st = buildStatus(state, town, id);
    const card = document.createElement('div');
    card.className = 'bcard' + (st.built ? ' built' : '') + (st.unlocked && !st.built ? ' open' : '');
    const nm = document.createElement('div');
    nm.className = 'bn';
    nm.textContent = def.name;
    const ds = document.createElement('div');
    ds.className = 'bd';
    ds.textContent = def.desc;
    const stt = document.createElement('div');
    stt.className = 'bs' + (st.spentToday ? ' warn' : '');
    stt.textContent = st.built ? '✓ 已建成' : st.reason;
    card.appendChild(nm);
    card.appendChild(ds);
    card.appendChild(stt);
    if (st.unlocked && !st.built) {
      const ready = st.affordable && !st.spentToday;
      card.appendChild(actionBtn('建造', ready, () => {
        act(() => {
          if (!build(state, town, id)) return st.spentToday ? '今日已建造过建筑' : '资源不足';
          return `${def.name} 建成`;
        });
      }));
    }
    grid.appendChild(card);
  }
  root.appendChild(grid);

  /* 可招募 */
  const rows = recruitRows(state, town);
  root.appendChild(sectionTitle('招募（花费金币从本周增长中征召）'));
  if (!rows.length) {
    root.appendChild(empty('尚未建成任何兵营'));
  } else {
    const list = document.createElement('div');
    list.className = 'rlist';
    for (const r of rows) {
      const u = getUnit(r.unitTypeId);
      const row = document.createElement('div');
      row.className = 'rrow';
      const nm = document.createElement('span');
      nm.className = 'un';
      nm.textContent = `${u.name} ×${r.available}`;
      const cs = document.createElement('span');
      cs.className = 'uc';
      cs.textContent = costText(r.cost);
      row.appendChild(nm);
      row.appendChild(cs);
      row.appendChild(
        actionBtn('招 1', r.affordable >= 1 && !!hero, () =>
          act(() => doRecruit(opts, r.unitTypeId, 1, 'hero'))),
      );
      row.appendChild(
        actionBtn('招 5', r.affordable >= 5 && !!hero, () =>
          act(() => doRecruit(opts, r.unitTypeId, 5, 'hero'))),
      );
      row.appendChild(
        actionBtn('全招', r.affordable >= 1 && !!hero, () =>
          act(() => doRecruit(opts, r.unitTypeId, r.available, 'hero'))),
      );
      row.appendChild(
        actionBtn('驻军', r.affordable >= 1, () =>
          act(() => doRecruit(opts, r.unitTypeId, r.available, 'garrison'))),
      );
      list.appendChild(row);
    }
    root.appendChild(list);
    if (!hero) root.appendChild(empty('城里没有英雄，「招募」只会进入驻军'));
  }

  /* 驻军 */
  root.appendChild(sectionTitle('驻军'));
  root.appendChild(
    armyList(town.garrison, hero ? (uid) => {
      act(() => {
        const h = opts.heroId ? state.heroes[opts.heroId] : null;
        if (!h) return '没有英雄';
        const n = garrisonToHero(h, town, uid, 9999);
        return n ? `${getUnit(uid).name} ×${n} 已编入队伍` : '英雄部队兵种已满';
      });
    } : null, '带走'),
  );

  /* 英雄部队 */
  if (hero) {
    root.appendChild(sectionTitle(`${hero.name} 的部队`));
    root.appendChild(
      armyList(hero.army, (uid) => {
        act(() => {
          const h = opts.heroId ? state.heroes[opts.heroId] : null;
          if (!h) return '没有英雄';
          const n = heroToGarrison(h, town, uid, 9999);
          return n ? `${getUnit(uid).name} ×${n} 留守城中` : '驻军兵种已满';
        });
      }, '留下'),
    );
  }

  /* 酒馆 & 市场 */
  const extra = document.createElement('div');
  extra.className = 'town-extra';
  if (town.buildings.includes('tavern')) {
    const hb = canHireHero(state, town);
    const wrap = document.createElement('div');
    wrap.className = 'ex-row';
    const t = document.createElement('span');
    t.textContent = `酒馆 · 招募英雄（${HERO_HIRE_COST} 金，每周一位）`;
    wrap.appendChild(t);
    wrap.appendChild(
      actionBtn('招募', hb.ok, () =>
        act(() => {
          const h = hireHero(state, town);
          if (!h) return '无法招募';
          opts.onHire(h.id);
          return `${h.name} 加入了你的麾下`;
        }),
        hb.ok ? '' : hb.reason,
      ),
    );
    extra.appendChild(wrap);
  }
  if (town.buildings.includes('market')) {
    const wrap = document.createElement('div');
    wrap.className = 'ex-row';
    const t = document.createElement('span');
    const bulk = MARKET_RATES.wood;
    t.textContent =
      `市场 · ${bulk.buyGold} 金买 ${bulk.buyAmount} 木/矿 · 卖 ${bulk.sellAmount} 木/矿得 ${bulk.sellGold} 金 · ` +
      `稀有资源 ${MARKET_RATES.gem.buyGold} 金买 1 / 卖 1 得 ${MARKET_RATES.gem.sellGold} 金`;
    wrap.appendChild(t);
    for (const r of ['wood', 'ore'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(`买${RESOURCE_LABEL[r]}`, (res.gold ?? 0) >= rate.buyGold, () =>
          act(() => (marketBuy(state, r) ? `买入${RESOURCE_LABEL[r]}` : '金币不足'))),
      );
    }
    for (const r of ['wood', 'ore'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(`卖${RESOURCE_LABEL[r]}`, (res[r] ?? 0) >= rate.sellAmount, () =>
          act(() => (marketSell(state, r) ? `卖出${RESOURCE_LABEL[r]}` : `${RESOURCE_LABEL[r]}不足`))),
      );
    }
    // 稀有资源：按个交易，卖出比买入便宜一半（市场是变现渠道，不是印钞机）
    for (const r of ['gem', 'crystal', 'sulfur', 'mercury'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(
          `买${RESOURCE_LABEL[r]}(${rate.buyGold})`,
          (res.gold ?? 0) >= rate.buyGold,
          () => act(() => (marketBuy(state, r) ? `买入${RESOURCE_LABEL[r]}` : '金币不足')),
          `${rate.buyGold} 金买 1 个${RESOURCE_LABEL[r]}；魔法行会与宝库都用得上`,
        ),
      );
      wrap.appendChild(
        actionBtn(
          `卖${RESOURCE_LABEL[r]}(${rate.sellGold})`,
          (res[r] ?? 0) >= rate.sellAmount,
          () => act(() => (marketSell(state, r) ? `卖出${RESOURCE_LABEL[r]}` : `${RESOURCE_LABEL[r]}不足`)),
          `卖 1 个${RESOURCE_LABEL[r]}得 ${rate.sellGold} 金`,
        ),
      );
    }
    extra.appendChild(wrap);
  }
  // 工坊：攻城器械只有在英雄站在城里时才能装到他身上
  if (town.buildings.includes('workshop')) {
    const wrap = document.createElement('div');
    wrap.className = 'ex-row';
    const t = document.createElement('span');
    const carried = hero ? heroWarMachines(hero).map((m) => WAR_MACHINES[m].name).join('、') : '';
    t.textContent = hero
      ? `工坊 · 装配攻城器械（${hero.name} 已带：${carried || '无'}）`
      : '工坊 · 装配攻城器械（需要一位英雄站在城中）';
    wrap.appendChild(t);
    for (const id of WAR_MACHINE_IDS) {
      const def = WAR_MACHINES[id];
      const chk = canAssemble(state, town, hero, id);
      wrap.appendChild(
        actionBtn(`${def.name}（${costText(def.cost)}）`, chk.ok, () =>
          act(() => {
            const h = opts.heroId ? state.heroes[opts.heroId] : null;
            if (!h) return '需要一位英雄站在城中';
            const r = assembleWarMachine(state, town, h, id);
            return r.ok ? `工坊装配了「${def.name}」` : r.reason;
          }),
          chk.ok ? def.desc : chk.reason,
        ),
      );
    }
    extra.appendChild(wrap);
  }
  if (extra.childElementCount) {
    root.appendChild(sectionTitle('城镇功能'));
    root.appendChild(extra);
  }
}

function doRecruit(opts: TownDialogOptions, unitTypeId: string, count: number, to: 'hero' | 'garrison'): string {
  const { state, townId } = opts;
  const town = state.towns[townId];
  const hero = opts.heroId ? state.heroes[opts.heroId] : null;
  const u = getUnit(unitTypeId);
  if (to === 'garrison') {
    const r = recruitToGarrison(state, town, unitTypeId, count);
    return r.taken ? `${u.name} ×${r.taken} 加入驻军` : r.reason;
  }
  const r = recruitToHero(state, town, hero, unitTypeId, count);
  return r.taken ? `${u.name} ×${r.taken} 加入队伍` : r.reason;
}

/* ---------------- dom helpers ---------------- */

function chip(text: string): HTMLElement {
  const e = document.createElement('span');
  e.className = 'chip-info';
  e.textContent = text;
  return e;
}

function sectionTitle(text: string): HTMLElement {
  const e = document.createElement('h3');
  e.className = 'th';
  e.textContent = text;
  return e;
}

function empty(text: string): HTMLElement {
  const e = document.createElement('div');
  e.className = 'empty';
  e.textContent = text;
  return e;
}

function actionBtn(label: string, enabled: boolean, onClick: () => void, title = ''): HTMLElement {
  const b = document.createElement('button');
  b.className = 'btn tiny' + (enabled ? '' : ' off');
  b.textContent = label;
  b.disabled = !enabled;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function armyList(
  army: { unitTypeId: string; count: number }[],
  onMove: ((unitTypeId: string) => void) | null,
  moveLabel: string,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'rlist';
  if (!army.length) {
    list.appendChild(empty('（空）'));
    return list;
  }
  for (const s of army) {
    const u = getUnit(s.unitTypeId);
    const row = document.createElement('div');
    row.className = 'rrow';
    const nm = document.createElement('span');
    nm.className = 'un';
    nm.textContent = `${u.name} ×${s.count}`;
    const st = document.createElement('span');
    st.className = 'uc';
    st.textContent = `攻${u.attack} 防${u.defense} 伤${u.damageMin}-${u.damageMax} 血${u.hp}`;
    row.appendChild(nm);
    row.appendChild(st);
    if (onMove) row.appendChild(actionBtn(moveLabel, true, () => onMove(s.unitTypeId)));
    list.appendChild(row);
  }
  return list;
}

export function formatCost(cost: ResourceBag): string {
  return costText(cost);
}
