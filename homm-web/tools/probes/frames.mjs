#!/usr/bin/env node
/**
 * frames.mjs —— 帧别名层（§29.4 S0）的机检（`npm run probe:frames`）。
 *
 * ## 它守什么
 * B1 会把 20 个兵种 id 全换掉，而图集里的帧名是 `u_<旧 id>_map` / `cu_<旧 id>`。
 * 别名层（`src/render/unitFrames.ts`）是"改数据"与"重画美术"之间唯一的桥：
 * 桥断了，地图部队、会面面板、战斗单位会**同时**变成空白，而且**不报错**。
 *
 * 四条断言各守一个失效方式：
 *   ① 表还是 20 行、值两两不同 —— 改阵容时漏一行/贴重一行；
 *   ② 20 个新 id 都指向**真实存在**的帧名 —— 帧名写错（拼写、旧 id 记错）；
 *   ③ 绕过别名层直拼必须取不到 —— 证明这层是**承重的**，不是装饰；
 *   ④ 未知名回退 + 只警告一次 —— 旧档/拼写错误降级为"色块 + 一条日志"，不白屏。
 *
 * ## 为什么可以在 Node 里跑（不用 Chrome）
 * 帧名的真值源是 `UNIT_FRAMES`（`unitArt.ts`），而 `atlas.ts` / `combatAtlas.ts` 都是
 * **遍历这个数组烘焙**（atlas.ts:1242 / combatAtlas.ts:153）⇒ "名字在数组里" 等价于
 * "图集里有这一帧"。像素是否为空的断言属于 `b0audit`（剪影/明度那套），这里不重复。
 * 好处是这条闸 0 浏览器、0 端口，可以进快速回归。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, distUrl, printHeader, requireFile, REPO_ROOT } from '../_dist.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIST = distDir();
printHeader(DIST, 'gate=frames');
requireFile(DIST, 'render/unitFrames.js');
requireFile(DIST, 'render/unitArt.js');

const { FRAME_ALIAS, unitFrameAlias, unitMapFrame, unitCombatFrame, warnMissingFrame, resetFrameWarnings, frameWarnCount } =
  await import(distUrl('render/unitFrames.js', DIST));
const { UNIT_FRAMES } = await import(distUrl('render/unitArt.js', DIST));
const { FACTION_UNITS } = await import(distUrl('core/data/units.js', DIST));

const names = new Set(UNIT_FRAMES.map((f) => f.name));
const has = (n) => names.has(n);

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

/* ---------------- ① 表的形状 ----------------
 * ⚠️ 行数**不写死 20**（S3a 起 p1 五兵已重画、不再需要别名，表从 20 行降到 15 行）。
 * 直接写 20 的后果是「重画完一批美术」反而让这条闸变红 —— 它量的是历史，不是契约。
 * 真正的契约是下面两条：① 表里不许有幽灵 id；③④⑤ 20 个兵种 id **都能取到帧**
 * （有别名走别名、没别名走直拼）。覆盖率把两套都算进来，所以撤别名不会让闸松。 */
const ALL_IDS = [...new Set(Object.values(FACTION_UNITS).flat())];
const NEW_IDS = Object.keys(FRAME_ALIAS);
const BASES = Object.values(FRAME_ALIAS);
const uniqBases = new Set(BASES);
const ghost = NEW_IDS.filter((id) => !ALL_IDS.includes(id));
PASS(
  ghost.length === 0,
  `① 别名表无幽灵行（${NEW_IDS.length} 行全部是真实兵种 id）${ghost.length ? `：多出 ${ghost.join(',')}` : ''}`,
);
PASS(uniqBases.size === BASES.length, `② 旧帧基名两两不同、没有贴重（${BASES.length} 行 → ${uniqBases.size} 个基名）`);

/* ---------------- ② 全部兵种 id 都指向真实帧 ---------------- */
const missMap = ALL_IDS.filter((id) => !has(unitMapFrame(id)));
const missIdle = ALL_IDS.filter((id) => !has(unitCombatFrame(id)));
const missAtk = ALL_IDS.filter((id) => !has(`${unitCombatFrame(id)}_atk`));
PASS(missMap.length === 0, `③ ${ALL_IDS.length} 个兵种 id 的地图帧全部存在${missMap.length ? `（缺 ${missMap.join(',')}）` : ''}`);
PASS(missIdle.length === 0, `④ ${ALL_IDS.length} 个兵种 id 的战斗 idle 帧全部存在${missIdle.length ? `（缺 ${missIdle.join(',')}）` : ''}`);
PASS(missAtk.length === 0, `⑤ ${ALL_IDS.length} 个兵种 id 的战斗 atk 帧全部存在${missAtk.length ? `（缺 ${missAtk.join(',')}）` : ''}`);

/* ---------------- ③ 负向对照：直拼必须取不到 ---------------- */
/** 恒等别名（FRAME_ALIAS[id] === id）直拼当然取得到 —— 它不是"别名在起作用"的样本，
 *  必须排除。S3c 删掉 `p3_dwarf` / `p3_treant` 两条恒等行后，这类样本归零；
 *  ⑥ 的期望值随之从 2 改成 0 —— 这是**契约变了**（p3 已有真帧），不是放宽判据。 */
const RENAMED = NEW_IDS.filter((id) => FRAME_ALIAS[id] !== id);
const IDENTICAL = NEW_IDS.filter((id) => FRAME_ALIAS[id] === id);
const rawHits = RENAMED.filter((id) => has(`u_${id}_map`) || has(`cu_${id}`));
PASS(
  RENAMED.length + IDENTICAL.length === NEW_IDS.length && IDENTICAL.length === 0,
  `⑥ ${RENAMED.length} 个真改名 + ${IDENTICAL.length} 个恒等（S3d 后 p4 最后五行已删、别名表为空）`,
);
// ⚠️ S3d（2026-11-08）之后别名表是**空**的：20 个兵全部有真帧，⑦⑧ 的样本数归零。
// 这两条仍保留，但**必须如实报告"不适用"**，不许在 0 样本时打印"承重"——
// 那会让人以为还有一层在兜底。真正承重的是 ③④⑤（20 个 id 的 map/idle/atk 都取得到）。
if (RENAMED.length === 0) {
  PASS(true, '⑦ 别名层已空 ⇒ 无改名样本，本判据不适用（承重的是 ③④⑤）');
  PASS(true, '⑧ 同上：0 个改名 id，无空操作可查');
} else {
  PASS(
    rawHits.length === 0,
    `⑦ 直拼（绕过别名层）取不到帧 —— 这一层是承重的${rawHits.length ? `（却取到了 ${rawHits.join(',')}）` : ''}`,
  );
  PASS(
    RENAMED.every((id) => unitMapFrame(id) !== `u_${id}_map`),
    `⑧ ${RENAMED.length} 个改名 id 的帧名与直拼结果确实不同（不是空操作）`,
  );
}

/* ---------------- ④ 未知名回退 + 只警告一次 ---------------- */
PASS(unitFrameAlias('foo_bar') === 'foo_bar', '⑨ 未知名原样透传（不抛错、不改写）');
PASS(!has(unitMapFrame('foo_bar')), '⑩ 未知名确实取不到帧（由调用方退化为色块）');

resetFrameWarnings();
const c0 = frameWarnCount();
warnMissingFrame('u_foo_bar_map', 'probe');
warnMissingFrame('u_foo_bar_map', 'probe'); // 同名第二次
const c1 = frameWarnCount();
warnMissingFrame('u_other_bar_map', 'probe'); // 换个名
const c2 = frameWarnCount();
PASS(c0 === 0, `⑪ 重置后计数归零（${c0}）`);
PASS(c1 === 1, `⑫ 同一个缺帧警告两次只记一次（${c1}）`);
PASS(c2 === 2, `⑬ 不同缺帧各记一次（${c2}）`);

/* ---------------- ⑤ 静态：别处不许再拼帧名（§29.4 S0 规矩①） ---------------- */
const FRAME_PAT = /`(?:u|cu)_\$\{/;
const FRAME_PAT_G = /`(?:u|cu)_\$\{/g;
/* 白名单 = **帧的定义方**，不是"关系户"：
 *   · `unitFrames.ts` —— 别名层本体，只有它有权把 id 变成帧名；
 *   · `combatAtlas.ts` —— 烘焙侧，给 `LEGACY_COMBAT_SPRITE_IDS`（狼/猪/食人魔）造 `cu_*`；
 *     帧名在这里是**被定义**的，不是被查找的。
 * 消费侧（渲染 / 面板 / 战斗）一个都不许进来 —— 那才是这条规矩要挡的。 */
const ALLOWED = new Set(['src/render/unitFrames.ts', 'src/render/combatAtlas.ts']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const offenders = [];
for (const abs of walk(path.join(REPO_ROOT, 'src'))) {
  const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
  if (ALLOWED.has(rel)) continue;
  readFileSync(abs, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (FRAME_PAT_G.test(line)) offenders.push(`${rel}:${i + 1}`);
      FRAME_PAT_G.lastIndex = 0; // 带 g 的正则复用必须复位，否则每次跳一行
    });
}
// 负向对照：同一个正则喂一行"违规样本"必须命中，否则上面那条是空跑（永远 0 条 = 恒绿）
PASS(FRAME_PAT.test('const n = `u_${id}_map`;'), '⑭ 扫描正则能命中违规样本（不是空跑）');
PASS(offenders.length === 0, `⑮ 除定义方外无人拼帧名${offenders.length ? `（违规 ${offenders.join(', ')}）` : ''}`);

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
