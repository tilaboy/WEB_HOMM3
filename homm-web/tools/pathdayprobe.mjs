#!/usr/bin/env node
/**
 * pathdayprobe.mjs —— 预览路径的**跨天分段**门（`npm run probe:pathday`）。
 *
 * ## 为什么要有这把尺
 * 跨天行程（一天走不完）在 2026-10-24 之前是一条**一以贯之的实线**：
 * 玩家点远处一格，线整条亮着，英雄走到一半停下、提示"明天按 M 继续" ——
 * 这才发现自己点远了。而"今天能走到哪"恰恰是一回合一次决策的游戏里最贵的一条信息。
 *
 * 现在同一条路径分成两段：今天 = 实线金，明天 = 虚线冷蓝，交界格一道"收工"刻痕。
 *
 * ## 判据（10 条 + `--selfcheck` 的翻转总账）
 *   `pathday`        —— 结构：`0 < cut < len`，`split === true`，两段都量到样本（今天 ≥2、明天 ≥1）；
 *   `pathday-cost`   —— 算术：`costs[cut-1] <= mp < costs[cut]`（分界正好落在最后一格可负担的格子上）；
 *   `pathday-dash`   —— 视觉：今天段中点**全部**有笔触，明天段中点**有缺口**（虚线的结构证据）；
 *   `cut-mark`       —— 刻痕：交界格中心 + **路径两侧**都被压黑（证它是横切的，不是线上粗了一截）；
 *   `edge-mark`      —— 交界出画时，屏幕边缘有一枚指示（画了 且 中心是墨色）；
 *   `edge-label`     —— 那枚指示旁边的「还有 N 天」：文字与天表独立对账、整块在视口内、对比 ≥4.5:1；
 *   `pathday-cuts`   —— 跨三天：两道交界，每道都落在当天预算的最后一步（天数 = 刻痕数 + 1）；
 *   `cut-cross-ctl`  —— 对照臂 `?devcutcross=0`：刻痕顺着路 ⇒ 两侧恢复底色（证 `cut-mark` 量的是朝向）；
 *   `pathday-ctl`    —— 对照臂 `?devpathday=0`：`split === false`、无刻痕、明天段 0 样本（= 旧表现）；
 *   `edge-ctl`       —— 对照臂 `?devpathedge=0`：指示与牌子都消失（证它由本层绘制）；
 *   `edge-label-ctl` —— 对照臂 `?devpathedgelabel=0`：牌子消失、指示仍在（证两块是分开的两件事）。
 *
 * 为什么 `pathday-dash` 用"中点有没有笔触"而不是比颜色：颜色会被昼夜光照的 multiply 拉偏
 * （暖色 tint 能把冷蓝拉回中性），而**虚线在格与格之间留下空档**是几何事实，光照改不了它。
 *
 * 为什么这条判据必须**钉住流动相位**（默认 `&devflowphase=0.5`）：虚线的相位在按墙上时间
 * 前进，所以"中点这一帧有没有笔触"是**随机抽样**。2026-11-08 连跑两次，同一 seed 下明天段
 * 留空数读到 3 和 1（门槛 2/9）⇒ 门时红时绿。钉相位只固定"抓哪一帧"，不碰门槛；
 * 流动本身由 `probe:pathflow` 单独把关（那里也钉自己的相位）。
 *
 * 为什么 `pathday` 需要一个专门的钩子：分段只在"目标超出今日移动力"时出现，
 * 而按可达点边缘选目标**永远**在今日范围内 ⇒ 用老钩子测分段，测出来永远是"没有分段"。
 * `__mapPreviewDay(mp)` 还会临时把移动力设小：满 1800 的跨天目标在十几格之外，
 * 整段"明天"都在屏幕外，取不到像素（`offScreen` 会把它记成"量不到"）。
 *
 * 用法：`node tools/pathdayprobe.mjs [--selfcheck] [--json] [--light=0.68] [--mp=300] [--seed=…]`
 * 退出码：0 全过 / 1 有判据不过
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5208));
const AS_JSON = process.argv.includes('--json');
const SELFCHECK = process.argv.includes('--selfcheck');
const SEED = opt('seed', '20260917');
/* 相位 0.68 = 深夜（关键帧最暗的一档）。选它不是为了好看：白天两段都足够亮，
 * 分段判据在白天不容易分辨"冷色被拉暖"这种事（§18.4 的老账）。 */
const LIGHT = opt('light', '0.68');
/** 临时移动力：200 ⇒ 今天约 2 格、明天再 2~3 格，两段都能完整落在 844×390 里。
 *  300 试过：目标 7 步，竖直方向会把"明天"整段顶出画布（实测出界 3/4，明天只剩 1 枚样本）。 */
const MP = Number(opt('mp', 200));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* `--extra=` 覆盖默认的相位钉（例如 `--extra=&devflow=0` 让虚线彻底静止）。
   ★ 这个参数曾经"写了但没接进 URL"（§16.3 栽过一次），这次一并接上并复核。 */
const EXTRA = opt('extra', '');
/* ★ **默认钉死虚线相位**。虚线是流动的（`MapRenderer.flowPhase` 按墙上时间推进），
   而 `pathday-dash` 量的是"明天段的中点有没有笔触"—— 本质上是**抓一帧**：
   相位不钉死 ⇒ 同一 seed 下留空数在 1~4 之间跳（2026-11-08 连跑两次读到 3 / 1，
   而门槛是 `ceil(9×0.2)=2`）⇒ 判据随机变红，看起来像功能回归。
   `0.5` 是半个虚线周期（3.0 实 + 4.2 空 = 7.2）；钉住之后连跑三次都是 4。
   门槛、几何、配色一个字没动 —— 只是把"抓哪一帧"从墙上时间换成常数；
   流动本身另有 `probe:pathflow` 把关（速度、减少动态、相位推进都在那）。 */
const FLOW_PIN = EXTRA || '&devflowphase=0.5';
const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1` +
  `&devreachprobe=1&devseed=${SEED}&devlight=${LIGHT}${FLOW_PIN}` +
  /* ★ 钉死"地图内容"这个未受控变量（2026-11-13 / P0）：封闭宝地会往同一颗 seed 的图里
   *   加 3 圈墙 + 守卫 + 奖励，代价场随之改变 ⇒ `mp=200` 的默认臂从"今天 2 格 / 明天 2 格"
   *   变成"今天 0 格 / 明天 0 格"，判据没量到对象就红。本门量的是**路径层的画法**，
   *   不是地图生成；其余臂（满移动力 / 跨三天 / 边缘指示）在宝地开着时照样全过，
   *   也印证了"红的是夹具、不是渲染"。阈值与判据一字未动。 */
  `&devpockets=0`;

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/**
 * 摆好一臂：导航 → 等主循环 → 让主程序摆一条"今天走不完"的路径 → 读探针。
 * `mpArg = null` ⇒ **不动移动力**（满 1800，交界必然在屏幕外，用来测边缘指示符）。
 */
async function arm(send, evaluate, query, label, callArgs = `${MP}`) {
  await send('Page.navigate', { url: BASE + query });
  for (let i = 0; i < 160; i++) {
    try {
      if (await evaluate(`!!document.querySelector('#thumb')`)) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(1200);
  for (let i = 0; i < 40; i++) {
    if (await evaluate('!!window.__bandStats')) break;
    await sleep(150);
  }
  await sleep(300);
  const hook = await evaluate(
    `window.__mapPreviewDay ? window.__mapPreviewDay(${callArgs}) : { ok: false, reason: '没有钩子' }`,
  );
  await sleep(420); // 让渲染循环按新状态画过一帧
  const pp = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
  if (!AS_JSON) {
    const d = (pp && pp.day) || {};
    console.log(
      `[${label}] 英雄 ${hook && hook.from ? `(${hook.from.x},${hook.from.y})` : '?'}` +
        ` → 目标 ${hook && hook.target ? `(${hook.target.x},${hook.target.y})` : '无'}` +
        ` · 路径 ${hook && hook.n ? hook.n : '?'} 步 · 今日 ${d.cut} 步（mp=${hook ? hook.mp : '?'}）` +
        ` · split=${d.split} · 今天 ${d.now ? d.now.n : '?'} 枚 / 明天 ${d.next ? d.next.n : '?'} 枚` +
        ` · 刻痕 ${d.cutScreen && d.cutScreen.length ? d.cutScreen.map((q) => `第${q.step}步@(${q.x},${q.y})`).join(' ') : '无'}` +
        ` · 边缘指示 ${pp && pp.edge && pp.edge.drawn ? `画了(${pp.edge.x},${pp.edge.y})` : '无'}` +
        (pp && pp.edgeCalc ? ` · 交界屏位 (${pp.edgeCalc.ex},${pp.edgeCalc.ey})/${pp.edgeCalc.vw}×${pp.edgeCalc.vh} inside=${pp.edgeCalc.inside}` : ''),
    );
  }
  return { hook, pp };
}

/** 四条主判据抽成函数：正常臂要全 true，对照臂要全 false（这就是负向对照）。 */
function crit(pp) {
  const d = (pp && pp.day) || {};
  const n = d.now || {};
  const x = d.next || {};
  return {
    day: d.split === true && d.cut > 0 && d.cut < d.len && n.n >= 2 && x.n >= 1,
    /* 用**细窗**（半径 1）的 covered：宽窗会把缺口两侧的墨一起收进来，虚线也永远"有笔触"。 */
    dash:
      n.fineN >= 2 &&
      n.fineCovered === 0 &&
      x.fineN >= 1 &&
      x.fineCovered >= Math.max(1, Math.ceil(x.fineN * 0.2)),
    /* 刻痕：中心被压黑**且**路径两侧（法线 ±3.2 世界 px）也被压黑。
       只量中心不够 —— 一根顺着路的墨杠同样把中心压黑（见 `cutCross` 注释）。 */
    mark:
      typeof d.cutLum === 'number' &&
      d.cutLum < 0.15 &&
      Array.isArray(d.cutCross) &&
      d.cutCross.length > 0 &&
      d.cutCross.every((q) => typeof q.a === 'number' && typeof q.b === 'number' && q.a < 0.08 && q.b < 0.08),
  };
}

let srv = null;
let code = 0;
try {
  if (!(await checkDevServer(PORT)).ok) {
    srv = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
    for (let i = 0; i < 120; i++) {
      if ((await checkDevServer(PORT)).ok) break;
      await sleep(120);
    }
  }
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 844,
        height: 390,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'hover', value: 'none' },
          { name: 'pointer', value: 'coarse' },
        ],
      });

      const A = await arm(send, evaluate, '', 'default（跨天分段）');
      const pp = A.pp || {};
      const d = pp.day || {};
      const hk = A.hook || {};
      const c = crit(pp);

      check(
        'pathday',
        '今天走不完时路径分成两段（交界既不在起点也不在终点，两段都有样本）',
        c.day,
        `split=${d.split} · cut=${d.cut}/${d.len} · 今天 ${d.now ? d.now.n : '?'} 枚（出界 ${d.now ? d.now.offScreen : '?'}）· 明天 ${d.next ? d.next.n : '?'} 枚（出界 ${d.next ? d.next.offScreen : '?'}）`,
      );

      /* 算术对账：`cut` 是"今天走完的**步数**"，所以第 cut 步（1-based）= `costs[cut-1]`（0-based）。
         它必须是"最后一格付得起的"，下一格必须付不起 —— 差一格就是"英雄在玩家没预料的地方停下"。 */
      const costs = (hk && hk.costs) || [];
      const cut = typeof d.cut === 'number' ? d.cut : -1;
      const prevOk = cut > 0 && cut <= costs.length && costs[cut - 1] <= hk.mp;
      const nextOk = cut >= 0 && cut < costs.length && costs[cut] > hk.mp;
      check(
        'pathday-cost',
        '分界落在"最后一格付得起、下一格付不起"（走的是同一个 stepCost）',
        prevOk && nextOk,
        `costs[${cut - 1}]=${costs[cut - 1]} ≤ mp=${hk.mp} < costs[${cut}]=${costs[cut]}`,
      );

      check(
        'pathday-dash',
        '今天实线、明天虚线（虚线在格与格之间留空 —— 几何事实，光照改不了）',
        c.dash,
        `今天中点 ${d.now ? d.now.fineN : '?'} 枚（细窗空 ${d.now ? d.now.fineCovered : '?'}）· ` +
          `明天中点 ${d.next ? d.next.fineN : '?'} 枚（细窗空 ${d.next ? d.next.fineCovered : '?'}）`,
      );

      const cx = (d.cutCross && d.cutCross[0]) || {};
      check(
        'cut-mark',
        '交界格中心与**路径两侧**都被压黑（证明刻痕是横切的，不是线上粗了一截）',
        c.mark,
        `中心 ${d.cutLum}（< 0.15）· 两侧 ${cx.a} / ${cx.b}（< 0.08）`,
      );

      /* --- 边缘指示：满移动力时交界在屏幕外，这条信息必须有出口 ---
         这一臂**不改移动力**（1800 ⇒ 今天约 18 格，视口纵向只有 11 格）⇒ 交界必然在屏外。 */
      /* 用**放大**（`?devzoom=2.4`，真机捏合也到得了）把交界挤出画面：
         这张图的 16 步只走了 9 格横 / 3 格竖（路线绕着地形走），1.2 倍时交界仍在屏内
         （实测 (511,310)）。2.4 倍下偏移翻倍 ⇒ 纵向 230 > 半高 195 ⇒ 出画。
         这比"推镜头 700px"诚实：不用把镜头推到地图外去看一片空。 */
      const E = await arm(send, evaluate, '&devzoom=2.4', '满移动力 · 放大（交界出画）', 'undefined');
      const ePp = E.pp || {};
      const eEdge = ePp.edge || {};
      const eDay = ePp.day || {};
      check(
        'edge-mark',
        '交界在屏幕外时，屏幕边缘有一枚指示（画了 且 中心是墨色）',
        eEdge.drawn === true && typeof eEdge.lum === 'number' && eEdge.lum < 0.15 && eDay.split === true,
        `drawn=${eEdge.drawn} · 位置 (${eEdge.x},${eEdge.y}) · 中心亮度 ${eEdge.lum} · 交界 ${eDay.cut}/${eDay.len}`,
      );

      /* --- 牌子上的"还有 N 天"：出画时唯一能说出"这一下要花几天"的地方 ---
         文字由渲染器写、天数由钩子的天表独立算 ⇒ 两边对账（不是"牌子非空就算过"）。
         对比度用牌子矩形内的亮度统计：`max` 是字（金）、`p35` 是牌底 ⇒ WCAG 口径 ≥4.5。
         位置必须**整个矩形**在视口内 —— 被边缘裁掉半句的牌子等于没写。 */
      const eLabel = ePp.edgeLabel || null;
      const eStops = (E.hook && E.hook.stops) || [];
      const wantText = eStops.length > 1 ? `还有 ${eStops.length - 1} 天` : null;
      const eInside =
        eLabel && ePp.edgeCalc
          ? eLabel.x >= 0 &&
            eLabel.y >= 0 &&
            eLabel.x + eLabel.w <= ePp.edgeCalc.vw &&
            eLabel.y + eLabel.h <= ePp.edgeCalc.vh
          : false;
      check(
        'edge-label',
        '交界出画时牌子写出「还有 N 天」，整块在视口内，金字压深底对比 ≥4.5:1',
        !!eLabel &&
          wantText !== null &&
          eLabel.text === wantText &&
          typeof eLabel.contrast === 'number' &&
          eLabel.contrast >= 4.5 &&
          eInside,
        `文字「${eLabel ? eLabel.text : '无'}」（应「${wantText}」）· 牌 (${eLabel ? eLabel.x : '-'},${eLabel ? eLabel.y : '-'}) ` +
          `${eLabel ? `${eLabel.w}×${eLabel.h}` : '-'}${eInside ? ' 在视口内' : ' 出界'} · 对比 ${eLabel ? eLabel.contrast : '-'}` +
          `（字 ${eLabel ? eLabel.max : '-'} / 底 ${eLabel ? eLabel.p35 : '-'}）· 天表 [${eStops.join(',')}]`,
      );

      /* 对照臂：只关牌子、不关指示符 ⇒ 牌子没了、指示符还在（证明两块是分开的两件事）。 */
      const EL = await arm(
        send,
        evaluate,
        '&devpathedgelabel=0&devzoom=2.4',
        'pathedgelabel=0（无牌子）',
        'undefined',
      );
      const elPp = EL.pp || {};
      check(
        'edge-label-ctl',
        '关掉牌子后同一场景牌子消失、指示符仍在（证牌子不是指示符的别名）',
        (elPp.edgeLabel ?? null) === null && ((elPp.edge || {}).drawn === true),
        `label=${elPp.edgeLabel ? '仍在' : 'null'} · drawn=${(elPp.edge || {}).drawn}`,
      );

      /* --- 多天：跨三天必须有**两道**刻痕（§21）---
         这一臂用 `minCost=2100` 把目标钉在"第 2 天走完、第 3 天没走完"的区间
         （mp=200 ⇒ 第 1 天 200、第 2 天 1800 ⇒ 累计 2000）。窗口窄到 12%，
         是为了让结果稳定落在三天，而不是四天。
         路径 20+ 步、大半在屏幕外 ⇒ 这条判据只验**结构**（交界个数与每道交界对应的预算），
         不验像素：像素那一半由上面 `cut-mark` 在一屏内的情况里负责。 */
      const M = await arm(send, evaluate, '', '跨三天（应有两道交界）', "200, 'horiz', 2100");
      const mHk = M.hook || {};
      const mD = (M.pp || {}).day || {};
      const stops = mHk.stops || [];
      const cutList = mD.cuts || [];
      const mCosts = mHk.costs || [];
      let cutsOk = stops.length >= 3 && cutList.length === stops.length - 1;
      const bad = [];
      for (let k = 0; k < cutList.length; k++) {
        const at = cutList[k];
        /* 第 1 天的预算 = 今日剩余；之后每天 = 前一天收工时的累计已花 + 一整天
           （换日不结转，见 `dayStops` 注释）。两处独立算：这里用钩子给的 `costs`，
           渲染器/主程序用的是逐格 `stepCost`。 */
        const budget =
          k === 0 ? mHk.mp : (mCosts[cutList[k - 1] - 1] ?? 0) + (mHk.maxMp ?? 0);
        const paid = mCosts[at - 1];
        const next = mCosts[at];
        if (!(paid <= budget && budget < next)) {
          cutsOk = false;
          bad.push(`第${k + 1}道@${at}: ${paid}≤${budget}<${next} 不成立`);
        }
        if (k > 0 && !(at > cutList[k - 1])) {
          cutsOk = false;
          bad.push(`第${k + 1}道未递增（${cutList[k - 1]} → ${at}）`);
        }
      }
      check(
        'pathday-cuts',
        '跨三天时每道交界都落在当天预算的最后一步（天数 = 刻痕数 + 1）',
        cutsOk,
        `天表 [${stops.join(', ')}] · 交界 [${cutList.join(', ')}]` +
          (bad.length ? ` · ${bad.join(' · ')}` : ` · 每天预算 ${mHk.mp} / +${mHk.maxMp}`),
      );

      /* --- 刻痕朝向的负向对照（常驻，不是只在 --selfcheck 里）---
         同一个交界格、同一根墨杠，只把旋转少 90° ⇒ 长轴顺着路。
         这时"中心"依然是黑的（墨盖住金芯），但**两侧**会恢复成底色 ——
         判据必须变红，否则它量的只是"那里有墨"，而不是"刻痕横着切过去"。 */
      const CR = await arm(send, evaluate, '&devcutcross=0', '刻痕顺着路（负向对照）');
      const crD = (CR.pp || {}).day || {};
      const crx = (crD.cutCross && crD.cutCross[0]) || {};
      check(
        'cut-cross-ctl',
        '把刻痕画成顺着路之后，两侧恢复底色（证 cut-mark 量的是"横切"）',
        typeof crx.a === 'number' && typeof crx.b === 'number' && (crx.a > 0.08 || crx.b > 0.08),
        `中心 ${crx.center} · 两侧 ${crx.a} / ${crx.b}（横切时应 <0.08）`,
      );

      /* 对照臂：关掉分段 = 旧表现（整条实线、无刻痕）。它必须**真的一分为二**，
         否则上面四条等于在测"有个钩子在跑"。 */
      const C = await arm(send, evaluate, '&devpathday=0', 'pathday=0（旧表现）');
      const cPp = C.pp || {};
      const cd = cPp.day || {};
      const cc = crit(cPp);
      check(
        'pathday-ctl',
        '关掉分段后回到旧表现：无交界、无刻痕、明天段 0 样本',
        cd.split === false && cd.cutLum === null && (cd.next ? cd.next.n : 0) === 0,
        `split=${cd.split} · cut=${cd.cut}/${cd.len} · cutLum=${cd.cutLum} · 明天 ${cd.next ? cd.next.n : 0} 枚`,
      );

      /* 同一满移动力场景，只关掉边缘指示（`?devpathedge=0`）⇒ 指示必须消失。
         这条的分辨力在于：它证明边缘那枚东西**是这一层画的**，不是地形或别的标记。 */
      const EC = await arm(send, evaluate, '&devpathedge=0&devzoom=2.4', 'pathedge=0（无边缘指示）', 'undefined');
      const ecEdge = ((EC.pp || {}).edge || {});
      check(
        'edge-ctl',
        '关掉边缘指示后，同一场景里那枚指示（连同牌子）消失（证它由本层绘制）',
        ecEdge.drawn === false && ((EC.pp || {}).edgeLabel ?? null) === null,
        `drawn=${ecEdge.drawn} · label=${(EC.pp || {}).edgeLabel ? '仍在' : 'null'}` +
          `（满移动力时交界仍在屏外：cut=${(EC.pp || {}).day ? (EC.pp || {}).day.cut : '?'}）`,
      );

      if (SELFCHECK) {
        /* 负向对照的本质：把**同一组判据**套到对照臂上，每一条都必须变红。
           只检"对照臂的 split=false"是不够的 —— 那只能证明钩子关了，
           证明不了 dash / cut-mark 这两条判据真的在测"今天/明天"而不是在测任何一条线。 */
        const ecEdge2 = (C.pp || {}).edge || {};
        /* 关掉分段之后，这两条也该翻红：没有刻痕（`pathday-cuts` 数出 0 道）
           与边缘指示（不该画却画了）。 */
        const cCuts = (C.pp || {}).day && (C.pp || {}).day.cuts ? (C.pp || {}).day.cuts.length : 0;
        const cStops = (C.hook || {}).stops || [];
        /* `edge-label` 没有"判据函数"，它的对照证据在 `edge-label-ctl` 那一臂上：
           牌子关掉后牌子矩形必须消失。这里对 `pathday=0` 臂复用同一事实（不分段 ⇒ 无牌子）。 */
        const cLabel = (C.pp || {}).edgeLabel ?? null;
        /* `cFlip[id] = true` 表示"这条判据在对照臂上**确实变红了**"
           （= 该判据在对照臂上不成立）。★ 这里容易写反：`cc.day` 是"判据成立"，
           要取反才是"变红" —— 首版把两者混用，结果 `ctl-flip` 把**四条全绿**报成通过。 */
        const cFlip = {
          'pathday': !cc.day,
          'pathday-dash': !cc.dash,
          'cut-mark': !cc.mark,
          'edge-mark': ecEdge2.drawn !== true,
          'edge-label': cLabel === null,
          'pathday-cuts': !(cStops.length >= 3 && cCuts === cStops.length - 1),
        };
        const flipped = Object.keys(cFlip).filter((k) => !cFlip[k]);
        check(
          'ctl-flip',
          '把同一组判据套到对照臂上，六条全变红（证每条都有分辨力）',
          flipped.length === 0,
          flipped.length
            ? `仍是绿的：${flipped.join('、')}`
            : 'pathday / pathday-dash / cut-mark / edge-mark / edge-label / pathday-cuts 六条全红',
        );
      }

      if (AS_JSON) {
        console.log(JSON.stringify({ rows, default: { hook: hk, pp }, control: { hook: C.hook, pp: cPp } }, null, 2));
      }
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'pday-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}

if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
