// balance-p2.mjs —— §16.2 数值表 / §23 全部读数 的唯一算式来源
// 运行：node production/ui-redesign-2026-10-28/tools/balance-p2.mjs [--a]
//
// 口径：P2 = H3 的 5% / 2.5% 非对称曲线 + 生存项。
//   攻击侧  mult_atk = min(1 + 0.05 × (攻 − 5), 4.0)     // +300% 封顶
//   防御侧  mult_def = max(1 − 0.025 × (防 − 5), 0.3)    // −70% 封顶
//   单兵战力 = 平均伤害 × HP × mult_atk / mult_def       // 参考对手 = 5 攻 / 5 防
//
// ⚠️ 2026-10-29 晚：本脚本原来把攻/防**两端都夹到 1**（A 口径：攻低于 5 不减伤、
//    防低于 5 不多受伤）。文档却一直宣称"H3 的 5%/2.5%"。主理人拍板用 **B 口径**
//    （只有 4.0 / 0.3 两个边界，不加 1 的夹子），A 口径降级为负向对照，用 `--a` 打印。
//
// 为什么 A 是错的：它把"攻低的真打不动"和"防低的真挨打"同时抹掉，
//   于是小孩（1/1）和矮人（2/3）被读成几乎一样强，AI 也就永远学不会"这个兵打不动人"。

const CALIBER = process.argv.includes('--a') ? 'A' : 'B';

const atkMult = (a) => {
  const m = 1 + 0.05 * (a - 5);
  return CALIBER === 'A' ? Math.min(Math.max(m, 1), 4) : Math.min(m, 4);
};
const defMult = (d) => {
  const m = 1 - 0.025 * (d - 5);
  return CALIBER === 'A' ? Math.min(Math.max(m, 0.3), 1) : Math.max(m, 0.3);
};
const power = (u) => ((u.dmg[0] + u.dmg[1]) / 2) * u.hp * (atkMult(u.atk) / defMult(u.def));

// §16.2 阵容。growth 为本次候选值（决策：B 口径 + 候选 1+）
const ROSTER = [
  ['p1', '小孩', 1, { atk: 1, def: 1, dmg: [1, 2], hp: 3, spd: 2, shots: 0, growth: 16, cost: 20, remote: false }],
  ['p1', '弩手', 2, { atk: 4, def: 2, dmg: [2, 4], hp: 10, spd: 4, shots: 14, growth: 5, cost: 110, remote: true }],
  ['p1', '鹰', 3, { atk: 6, def: 3, dmg: [4, 6], hp: 14, spd: 9, shots: 0, growth: 4, cost: 240, remote: false }],
  ['p1', '骑士', 4, { atk: 7, def: 8, dmg: [7, 9], hp: 36, spd: 7, shots: 0, growth: 3, cost: 520, remote: false }],
  ['p1', '天使', 5, { atk: 10, def: 10, dmg: [13, 17], hp: 65, spd: 8, shots: 0, growth: 2, cost: 1500, remote: false }],
  ['p2', '火柴人', 1, { atk: 2, def: 1, dmg: [1, 3], hp: 3, spd: 4, shots: 8, growth: 12, cost: 30, remote: true }],
  ['p2', '铜人', 2, { atk: 3, def: 9, dmg: [2, 3], hp: 15, spd: 2, shots: 0, growth: 5, cost: 120, remote: false }],
  ['p2', '三头狼', 3, { atk: 7, def: 3, dmg: [3, 8], hp: 13, spd: 7, shots: 0, growth: 4, cost: 230, remote: false }],
  ['p2', '熔岩巨人', 4, { atk: 9, def: 7, dmg: [6, 9], hp: 34, spd: 4, shots: 0, growth: 3, cost: 520, remote: false }],
  ['p2', '恶魔', 5, { atk: 12, def: 7, dmg: [14, 18], hp: 55, spd: 9, shots: 0, growth: 2, cost: 1250, remote: false }],
  ['p3', '矮人', 1, { atk: 2, def: 3, dmg: [1, 2], hp: 5, spd: 3, shots: 0, growth: 10, cost: 25, remote: false }],
  ['p3', '丛林射手', 2, { atk: 4, def: 3, dmg: [2, 3], hp: 11, spd: 4, shots: 16, growth: 5, cost: 115, remote: true }],
  ['p3', '树人', 3, { atk: 4, def: 10, dmg: [3, 5], hp: 20, spd: 2, shots: 0, growth: 4, cost: 260, remote: false }],
  ['p3', '猿人', 4, { atk: 8, def: 4, dmg: [7, 10], hp: 30, spd: 5, shots: 10, growth: 4, cost: 540, remote: true }],
  ['p3', '绿龙', 5, { atk: 11, def: 9, dmg: [11, 15], hp: 62, spd: 7, shots: 0, growth: 2, cost: 1100, remote: false }],
  ['p4', '骷髅', 1, { atk: 2, def: 1, dmg: [1, 3], hp: 4, spd: 4, shots: 0, growth: 9, cost: 25, remote: false }],
  ['p4', '僵尸', 2, { atk: 2, def: 8, dmg: [2, 3], hp: 15, spd: 2, shots: 0, growth: 5, cost: 115, remote: false }],
  ['p4', '吸血鬼', 3, { atk: 7, def: 4, dmg: [3, 6], hp: 15, spd: 8, shots: 0, growth: 5, cost: 250, remote: false }],
  ['p4', '牛头怪', 4, { atk: 9, def: 6, dmg: [7, 10], hp: 30, spd: 6, shots: 10, growth: 5, cost: 540, remote: true }],
  ['p4', '摄魂怪', 5, { atk: 10, def: 8, dmg: [10, 13], hp: 60, spd: 9, shots: 0, growth: 2, cost: 800, remote: false }],
];

const FAM = ['p1', 'p2', 'p3', 'p4'];
const REMOTE_K = 1.25; // 决策 48：只进 aiValue
const units = ROSTER.map(([fam, name, tier, u]) => ({ fam, name, tier, ...u, power: power(u) }));

const spread = (a) => (Math.max(...a) / Math.min(...a) - 1) * 100;
const pad = (s, n) => String(s).padEnd(n, ' ');
const n1 = (x) => x.toFixed(1);

console.log(`=== 口径 ${CALIBER} ===`);
console.log('单兵战力：');
for (const f of FAM) {
  console.log(' ', f, units.filter((u) => u.fam === f).map((u) => `${u.name} T${u.tier} ${n1(u.power)}`).join(' | '));
}

const byTier = (t) => FAM.map((f) => units.find((u) => u.fam === f && u.tier === t).power);
console.log('\n同档跨族极差：');
for (let t = 1; t <= 5; t++) {
  const v = byTier(t);
  console.log(`  T${t}  ${v.map(n1).join(' / ')}  ${spread(v).toFixed(1)}%`);
}

// 周产 / 账单 / aiValue。王牌建筑 = 本族 T3 周产 ×1.5（决策 42）
const T3_BONUS = 0.5;
const weekly = {};
for (const f of FAM) {
  const list = units.filter((u) => u.fam === f);
  const powerW = list.reduce((s, u) => s + u.power * u.growth, 0);
  const aiW = list.reduce((s, u) => s + u.power * (u.remote ? REMOTE_K : 1) * u.growth, 0);
  const bill = list.reduce((s, u) => {
    const g = u.tier === 3 ? u.growth * (1 + T3_BONUS) : u.growth;
    return s + u.cost * g;
  }, 0);
  const hpW = list.reduce((s, u) => s + u.hp * u.growth, 0);
  weekly[f] = { powerW, aiW, bill, hpW };
}
const pw = FAM.map((f) => weekly[f].powerW);
const aw = FAM.map((f) => weekly[f].aiW);
const bl = FAM.map((f) => weekly[f].bill);

console.log('\n族级周产：');
FAM.forEach((f, i) => {
  console.log(
    `  ${f}  战力 ${n1(pw[i])}  aiValue ${n1(aw[i])}  账单 ${Math.round(bl[i])}  战力/账单 ${(pw[i] / bl[i]).toFixed(3)}`,
  );
});
console.log(`  战力极差 ${spread(pw).toFixed(1)}%   aiValue 极差 ${spread(aw).toFixed(1)}%   账单极差 ${spread(bl).toFixed(1)}%`);
console.log(`  战力/账单 极差 ${spread(FAM.map((f) => weekly[f].powerW / weekly[f].bill)).toFixed(1)}%`);

const t1ai = FAM.map((f) => {
  const u = units.find((x) => x.fam === f && x.tier === 1);
  return u.power * (u.remote ? REMOTE_K : 1) * u.growth;
});
const t1pw = FAM.map((f) => {
  const u = units.find((x) => x.fam === f && x.tier === 1);
  return u.power * u.growth;
});
console.log(`  T1 周产战力 ${t1pw.map((x) => x.toFixed(0)).join('/')} 极差 ${spread(t1pw).toFixed(1)}%`);
console.log(`  T1 周产 aiValue ${t1ai.map((x) => x.toFixed(0)).join('/')} 极差 ${spread(t1ai).toFixed(1)}%`);
console.log(`  远程系数 1.0 时 aiValue 极差 ${spread(FAM.map((f) => units.filter((u) => u.fam === f).reduce((s, u) => s + u.power * u.growth, 0))).toFixed(1)}%`);

// T5 经济
const t5 = FAM.map((f) => units.find((u) => u.fam === f && u.tier === 5));
const pg = t5.map((u) => u.power / u.cost);
console.log('\nT5：');
console.log('  战力', t5.map((u) => n1(u.power)).join(' / '), `极差 ${spread(t5.map((u) => u.power)).toFixed(1)}%`);
console.log('  单价', t5.map((u) => u.cost).join(' / '), `极差 ${spread(t5.map((u) => u.cost)).toFixed(1)}%`);
console.log('  每金战力', pg.map((x) => x.toFixed(3)).join(' / '), `极差 ${spread(pg).toFixed(1)}%`);
const monotone = pg.every((v, i) => i === 0 || v >= pg[i - 1]);
console.log('  每金单调（越便宜越划算）:', monotone ? 'PASS' : 'FAIL');

// 20 个 aiValue（决策 44 / §25.3 的目标读数）
console.log('\n--- §25.3 aiValue（= 战力 × 远程 1.25）---');
for (const f of FAM) {
  console.log(
    '| ' + f + ' | ' + units.filter((u) => u.fam === f).map((u) => `${u.name} ${Math.round(u.power * (u.remote ? REMOTE_K : 1))}`).join(' | ') + ' |',
  );
}

// 校验
const fail = [];
if (spread(pw) > 8) fail.push(`V1 族总 ${spread(pw).toFixed(1)}% > 8%`);
if (spread(bl) > 12) fail.push(`V2 账单 ${spread(bl).toFixed(1)}% > 12%`);
if (spread(aw) > 12) fail.push(`V6 ${spread(aw).toFixed(1)}% > 12%`);
if (spread(t1ai) > 40) fail.push(`V6-T1 ${spread(t1ai).toFixed(1)}% > 40%`);
const r = spread(t5.map((u) => u.power));
if (r < 40 || r > 60) fail.push(`V3 T5 战力极差 ${r.toFixed(1)}% 不在 40~60%`);
if (!monotone) fail.push('V4 T5 每金不单调');
console.log('\n=== 闸 ===');
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS（V1/V2/V3/V4/V6 全绿）');
