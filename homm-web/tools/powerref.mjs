/**
 * powerref.mjs —— H1 的验收门：**引擎里的 `powerRef()` 必须复现 §25.3 的 20 个数**。
 *
 * 为什么它不是报表：这张表是 B1 批 20 个 `aiValue` 的来源。尺子一旦和文档不一致，
 * B1 填出来的 `aiValue` 就会"看起来有依据"，而实际上量的是另一个游戏（铁律 14 的同型）。
 *
 * 三条判据（任一不过 ⇒ exit 1）：
 *   A. 20 个战力逐条与 §25.3 相差 ≤2%
 *   B. 两条 clamp 边界：`atk=65 ⇒ 4.0`、`def=33 ⇒ 0.3`（本作永远触发不到，但代码必须对）
 *   C. 负向对照：把两端夹到 1（A 口径）会让小孩从 3.3 变成 4.5 ⇒ 证明"夹到 1"真的能被读数看出来
 *
 * 跑法：`node tools/powerref.mjs`（⚠️ 先 `npm run build`，读的是 `dist/`）
 */
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=powerref');
requireFile(DIST, 'core/combat/damage.js');

const { attackMultiplier, defenseMultiplier, damageMultiplier, powerRef } = await import(
  distUrl('core/combat/damage.js', DIST)
);

/* ---------- §25.3 的目标读数（B 口径，不含远程 1.25） ---------- */
const SPEC = [
  ['p1', '小孩', 1, 1, 1, 2, 3, 3.3],
  ['p1', '弩手', 4, 2, 2, 4, 10, 26.5],
  ['p1', '鹰', 6, 3, 4, 6, 14, 70.0],
  ['p1', '骑士', 7, 8, 7, 9, 36, 342.5],
  ['p1', '天使', 10, 10, 13, 17, 65, 1392.9],
  ['p2', '火柴人', 2, 1, 1, 3, 3, 4.6],
  ['p2', '铜人', 3, 9, 2, 3, 15, 37.5],
  ['p2', '三头狼', 7, 3, 3, 8, 13, 74.9],
  ['p2', '熔岩巨人', 9, 7, 6, 9, 34, 322.1],
  ['p2', '恶魔', 12, 7, 14, 18, 55, 1250.5],
  ['p3', '矮人', 2, 3, 1, 2, 5, 6.1],
  ['p3', '丛林射手', 4, 3, 2, 3, 11, 24.9],
  ['p3', '树人', 4, 10, 3, 5, 20, 86.9],
  ['p3', '猿人', 8, 4, 7, 10, 30, 286.1],
  ['p3', '绿龙', 11, 9, 11, 15, 62, 1164.2],
  ['p4', '骷髅', 2, 1, 1, 3, 4, 6.2],
  ['p4', '僵尸', 2, 8, 2, 3, 15, 34.5],
  ['p4', '吸血鬼', 7, 4, 3, 6, 15, 72.4],
  ['p4', '牛头怪', 9, 6, 7, 10, 30, 313.8],
  ['p4', '摄魂怪', 10, 8, 10, 13, 60, 932.4],
];

const rows = [];
let bad = 0;
console.log('\n=== A. §25.3 的 20 个数（引擎 powerRef vs 文档，容差 2%） ===');
for (const [fam, name, atk, def, dmgMin, dmgMax, hp, want] of SPEC) {
  const got = powerRef({ attack: atk, defense: def, damageMin: dmgMin, damageMax: dmgMax, hp });
  const dev = Math.abs(got - want) / want;
  const ok = dev <= 0.02;
  if (!ok) bad += 1;
  rows.push(`${ok ? '✓' : '✗'} ${fam} ${name.padEnd(6, ' ')} ${got.toFixed(1).padStart(8)}  want ${String(want).padStart(7)}  ${(dev * 100).toFixed(2)}%`);
}
console.log(rows.join('\n'));

console.log('\n=== B. 估值侧的两个 clamp（本作触发不到，但定义必须对） ===');
const edges = [
  ['attackMultiplier(65) ⇒ 4.0', attackMultiplier(65), 4.0],
  ['attackMultiplier(64) ⇒ 3.95', attackMultiplier(64), 3.95],
  ['attackMultiplier(5) ⇒ 1.0', attackMultiplier(5), 1.0],
  ['defenseMultiplier(33) ⇒ 0.3', defenseMultiplier(33), 0.3],
  ['defenseMultiplier(32) ⇒ 0.325', defenseMultiplier(32), 0.325],
  ['defenseMultiplier(5) ⇒ 1.0', defenseMultiplier(5), 1.0],
  ['powerRef(5/5 的兵) = 伤害 × HP', powerRef({ attack: 5, defense: 5, damageMin: 10, damageMax: 10, hp: 10 }), 100],
  // 实战公式是**分段式**（差额），不是两侧相除 —— 这条是防止有人"顺手改回去"
  ['damageMultiplier(5,5) ⇒ 1.0', damageMultiplier(5, 5), 1.0],
  ['damageMultiplier(10,10) ⇒ 1.0（分段式，不是 1.4286）', damageMultiplier(10, 10), 1.0],
  ['damageMultiplier(4,1) ⇒ 1.15（差 +3）', damageMultiplier(4, 1), 1.15],
  ['damageMultiplier(5,10) ⇒ 0.8889（差 −5，2.5%/点）', damageMultiplier(5, 10), 0.8889],
  ['damageMultiplier(1,10) ⇒ 0.8163', damageMultiplier(1, 10), 0.8163],
  ['damageMultiplier(65,5) ⇒ 4.0（顶）', damageMultiplier(65, 5), 4.0],
  ['damageMultiplier(5,200) ⇒ 0.3（底）', damageMultiplier(5, 200), 0.3],
];
for (const [label, got, want] of edges) {
  const tol = Math.abs(want) > 10 ? 0.01 : 1e-3;
  const ok = Math.abs(got - want) < tol;
  if (!ok) bad += 1;
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(50, ' ')} got ${got.toFixed(4)}`);
}

// 单调性：攻越高伤害越高、防越高伤害越低（两侧都不许出现平台）
let monoBad = 0;
for (let a = 1; a < 20; a++) if (!(damageMultiplier(a + 1, 5) > damageMultiplier(a, 5))) monoBad += 1;
for (let d = 1; d < 20; d++) if (!(damageMultiplier(5, d + 1) < damageMultiplier(5, d))) monoBad += 1;
if (monoBad) bad += 1;
console.log(`${monoBad === 0 ? '✓' : '✗'} 单调性：攻 1~19 递增、防 1~19 递减（${monoBad} 处平台）`);

console.log('\n=== C. 负向对照：A 口径（两端夹到 1）必须读出 4.5 ===');
const aAtk = (a) => Math.min(Math.max(1 + 0.05 * (a - 5), 1), 4);
const aDef = (d) => Math.min(Math.max(1 - 0.025 * (d - 5), 0.3), 1);
const childA = ((1 + 2) / 2) * 3 * (aAtk(1) / aDef(1));
const childB = powerRef({ attack: 1, defense: 1, damageMin: 1, damageMax: 2, hp: 3 });
const ctlOk = Math.abs(childA - 4.5) < 0.05 && Math.abs(childB - 3.3) < 0.05;
if (!ctlOk) bad += 1;
console.log(`${ctlOk ? '✓' : '✗'} 小孩 A=${childA.toFixed(1)} / B=${childB.toFixed(1)}（A 必须 4.5、B 必须 3.3）`);

/* ==========================================================================
 * D. 升级形态（S4 · spec §2.5）
 *
 * 这一段**不是报表**：`UNITS` 里 20 个 `_u` 是代码按五条系数生成的，本段逐条复算，
 * 确认"生成的确实是那五条"，并跑唯一硬闸 `powerRef(升级版) ≤ 同族下一档 × 0.9`。
 *
 * 为什么闸读公式而不是读表（决策 66）：表只回答"这一行长什么样"，闸回答"它有没有越界"。
 * 排一张表就等于把同一份信息抄两遍，改基础值时要改两处。
 * ========================================================================== */
const { UNITS, FACTION_UNITS, MONSTER_UNIT_IDS, baseUnitIdOf, upgradedUnitIdOf } = await import(
  distUrl('core/data/units.js', DIST)
);

const FAMS = ['p1', 'p2', 'p3', 'p4'];
const CAP = 0.9;
console.log('\n=== D. 升级形态：五条系数 + 封顶闸（≤ 同族下一档 × 0.9） ===');

/** 系数复算：返回不成立的项（空数组 = 全对）。**只读基础版**，不读生成的升级版。 */
function coefProblems(base, up) {
  const out = [];
  const want = {
    attack: base.attack + 1,
    defense: base.defense + 1,
    damageMin: base.damageMin,
    damageMax: base.damageMax + 1,
    hp: Math.ceil(base.hp * 1.25),
    speed: base.speed,
  };
  for (const [k, v] of Object.entries(want)) {
    if (up[k] !== v) out.push(`${k} ${up[k]}≠${v}`);
  }
  // 价：逐项 round(×1.2)，非零项至少 1
  for (const [k, v] of Object.entries(base.cost)) {
    const wantC = v ? Math.max(1, Math.round(v * 1.2)) : 0;
    if ((up.cost[k] ?? 0) !== wantC) out.push(`cost.${k} ${up.cost[k] ?? 0}≠${wantC}`);
  }
  for (const k of Object.keys(up.cost)) {
    if (!(k in base.cost)) out.push(`cost 多出 ${k}`);
  }
  if (up.upgradeOf !== base.id) out.push(`upgradeOf ${up.upgradeOf}≠${base.id}`);
  if (up.expValue !== base.expValue) out.push('expValue 被改了');
  if (up.growthPerWeek !== base.growthPerWeek) out.push('growthPerWeek 被改了');
  if (!!up.shots !== !!base.shots) out.push('shots 被改了');
  return out;
}

let capRows = 0;
let capSkip = 0;
let tightest = { pct: 0, who: '' };
for (const fam of FAMS) {
  const ids = FACTION_UNITS[fam];
  for (let i = 0; i < ids.length; i++) {
    const base = UNITS[ids[i]];
    const upId = upgradedUnitIdOf(base.id);
    if (!upId) {
      bad += 1;
      console.log(`✗ ${fam} ${base.name}：缺升级形态 ${base.id}${'_u'}`);
      continue;
    }
    const up = UNITS[upId];
    const probs = coefProblems(base, up);
    const nextId = ids[i + 1];
    const next = nextId ? UNITS[nextId] : null;
    const pe = powerRef(up);
    let capTxt = '不适用（T5 已是本族封顶）';
    if (next) {
      // ⚠️ **两个分母，两个数，必须都印**。
      //   `pct`  = 升级版战力 / **下一档战力**（"它有多接近下一档"）
      //   `used` = 升级版战力 / **闸上限（下一档 × 0.9）**（"闸用了多少"）
      // 2026-11-09 踩过：本脚本只印 pct（铜人 82.6%），而 `audit:balance --upgrades`
      // 印的是 used（同一条 91.8%）—— 两个门对同一个兵给出两个百分比，
      // 谁看都以为其中一个错了。判词用 used（>100 才是越界），pct 保留作读数。
      const nextPow = powerRef(next);
      const pct = (pe / nextPow) * 100;
      const used = (pe / (nextPow * CAP)) * 100;
      capSkip += 0;
      capRows += 1;
      if (used > tightest.pct) tightest = { pct: used, who: `${fam} ${up.name}` };
      const ok = pe <= nextPow * CAP;
      if (!ok) {
        probs.push(`封顶 闸内 ${used.toFixed(1)}% > 100%（下一档 ${next.name} 的 90% = ${(nextPow * CAP).toFixed(1)}）`);
      }
      capTxt = `对下一档 ${pct.toFixed(1)}% · 闸内 ${used.toFixed(1)}%`;
    } else {
      capSkip += 1;
    }
    if (probs.length) bad += 1;
    const dmg = `${base.damageMin}-${base.damageMax}→${up.damageMin}-${up.damageMax}`;
    console.log(
      `${probs.length ? '✗' : '✓'} ${fam} ${base.name}→${up.name}`.padEnd(26, ' ') +
        ` 攻 ${base.attack}→${up.attack} 防 ${base.defense}→${up.defense} 伤 ${dmg} ` +
        `HP ${base.hp}→${up.hp} 速 ${up.speed} 价 ${base.cost.gold ?? 0}→${up.cost.gold ?? 0} ` +
        `战力 ${powerRef(base).toFixed(1)}→${pe.toFixed(1)}  ${capTxt}` +
        (probs.length ? `  ⚠ ${probs.join(' / ')}` : ''),
    );
  }
}
// 覆盖闸：20 个升级形态、自指正确、中立怪不许有
const allUp = Object.keys(UNITS).filter((id) => id.endsWith('_u'));
const expectUp = FAMS.flatMap((f) => FACTION_UNITS[f].map((id) => `${id}_u`));
const missing = expectUp.filter((id) => !UNITS[id]);
const extra = allUp.filter((id) => !expectUp.includes(id));
const badBack = allUp.filter((id) => {
  const b = baseUnitIdOf(id);
  return UNITS[b]?.upgradeOf !== undefined || UNITS[id]?.upgradeOf !== b;
});
const monsterLeak = MONSTER_UNIT_IDS.filter((id) => UNITS[`${id}_u`]);
if (missing.length || extra.length || badBack.length || monsterLeak.length) bad += 1;
console.log(
  `${!missing.length && !extra.length && !badBack.length && !monsterLeak.length ? '✓' : '✗'} ` +
    `覆盖：升级形态 ${allUp.length}/20${missing.length ? ` 缺 ${missing.join(',')}` : ''}` +
    `${extra.length ? ` 多 ${extra.join(',')}` : ''}${badBack.length ? ` 自指错 ${badBack.join(',')}` : ''}` +
    `${monsterLeak.length ? ` 中立怪不该有 ${monsterLeak.join(',')}` : ''}`,
);
console.log(
  `   封顶闸 ${capRows} 条生效 / ${capSkip} 条不适用（T5）· 最紧 ${tightest.who || '-'} 闸内 ${tightest.pct.toFixed(1)}%`,
);

/* 负向对照：闸必须还能变红（否则"全过"只证明它没在看） */
const bronze = UNITS['p2_bronze'];
const fatBronze = { ...UNITS['p2_bronze_u'], hp: 40, attack: 8 };
const fatPct = (powerRef(fatBronze) / powerRef(UNITS['p2_threewolf'])) * 100;
const fatUsed = fatPct / CAP; // 闸内占用 = 占下一档 / 0.9
const coefCtrl = coefProblems(bronze, { ...UNITS['p2_bronze_u'], hp: bronze.hp }).length > 0;
const capCtrl = fatUsed > 100;
if (!coefCtrl || !capCtrl) bad += 1;
console.log(
  `${coefCtrl && capCtrl ? '✓' : '✗'} 负向对照：把 HP 改回基础值 ⇒ 系数闸报警；` +
    `把铜人抬到 8/10/40 ⇒ 占下一档 ${fatPct.toFixed(1)}% · 闸内 ${fatUsed.toFixed(1)}%（>100），闸仍会红`,
);

console.log(`\n=== ${bad === 0 ? 'PASS' : `FAIL（${bad} 条）`} ===`);
if (bad > 0) process.exitCode = 1;
