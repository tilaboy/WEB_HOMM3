// h3-growth.mjs —— §22 的 H3 原始产量/造价矩阵（wiki 抄录，不是推测）
// 运行：node production/ui-redesign-2026-10-28/tools/h3-growth.mjs
// ⚠️ 尾部「我们的现状」读的是 **2026-10-29 重定价之前** 的 T5（1250~1300），
//    也就是 §22.6 那张表；§23.2 之后这组数**已作废**，只作历史对照。
//    现行读数看 balance-p2.mjs。别拿本文件尾部当现状。
// ---------- H3 T7 原始数据（wiki Comparison of Level 7 Creatures） ----------
const t7 = [
  // name, town, atk, def, dmg, hp, spd, growth, cost, ai
  ['天使',      '城堡', 20,20,'50',   200,12,1,3000,5019],
  ['绿龙',      '壁垒', 18,18,'40-50',180,10,1,2400,4872],
  ['巨人',      '塔楼', 19,16,'40-60',150, 7,1,2000,3718],
  ['恶魔',      '地狱', 19,21,'30-40',160,11,1,2700,5101],
  ['骨龙',      '墓园', 17,15,'25-50',150, 9,1,1800,3388],
  ['红龙',      '地下', 19,19,'40-50',180,11,1,2500,4702],
  ['比蒙',      '据点', 17,17,'30-50',160, 6,1,1500,3162],
  ['九头蛇',    '要塞', 16,18,'25-45',175, 5,1,2200,4120],
  ['凤凰(AB)',  '元素', 18,18,'30-40',150,15,2,1500,4547],
  ['凤凰(HotA)','元素', 18,18,'30-40',150,15,1,2000,4336],
];
console.log('=== H3 七级兵：产量 / 价格 / 每周满产战力 ===');
console.log('兵种'.padEnd(12)+'族'.padEnd(5)+'攻/防'.padEnd(8)+'HP'.padEnd(5)+'速'.padEnd(4)+'周产'.padEnd(5)+'单价'.padEnd(7)+'满产金'.padEnd(8)+'每周战力'.padEnd(9)+'每金战力');
const rows = t7.map(([n,t,a,d,dm,hp,sp,g,c,ai])=>{
  const maxG = g*2;               // ×2 = 城堡（fortification）
  const gold = maxG*c, pwr = maxG*ai;
  return {n,t,a,d,hp,sp,g,c,ai,maxG,gold,pwr,eff:ai/c};
});
for (const r of rows) {
  console.log(r.n.padEnd(12)+r.t.padEnd(5)+`${r.a}/${r.d}`.padEnd(8)+String(r.hp).padEnd(5)+String(r.sp).padEnd(4)+String(r.g).padEnd(5)+String(r.c).padEnd(7)+String(r.gold).padEnd(8)+String(r.pwr).padEnd(9)+r.eff.toFixed(3));
}
const core = rows.filter(r=>!r.n.startsWith('凤凰'));
const g = k => core.map(r=>r[k]);
const sp = (a)=>(Math.max(...a)/Math.min(...a)-1)*100;
console.log('\n八族（不含凤凰）离散：');
console.log(`  周产     1 全同（0%）`);
console.log(`  单价     ${Math.min(...g('c'))} ~ ${Math.max(...g('c'))}  = ${sp(g('c')).toFixed(0)}%`);
console.log(`  每周战力 ${Math.min(...g('pwr'))} ~ ${Math.max(...g('pwr'))} = ${sp(g('pwr')).toFixed(0)}%`);
console.log(`  每金战力 ${Math.min(...g('eff')).toFixed(3)} ~ ${Math.max(...g('eff')).toFixed(3)} = ${sp(g('eff')).toFixed(0)}%`);
console.log(`\n凤凰 AB 每周战力 18188 = 天使 10038 的 ${(18188/10038).toFixed(2)} 倍，而同为 6000 金`);
console.log(`凤凰 HotA 13008 = 天使的 ${(13008/10038).toFixed(2)} 倍`);

// ---------- H3 九族周产量矩阵 ----------
const growthH3 = {
  '城堡':[14,9,7,4,3,2,1], '壁垒':[14,8,7,5,3,2,1], '塔楼':[16,9,6,4,3,2,1],
  '地狱':[15,8,5,4,3,2,1], '墓园':[12,8,7,4,3,2,1], '地下':[14,8,7,4,3,2,1],
  '据点':[15,9,7,4,3,2,1], '要塞':[12,9,8,4,3,2,1], '元素':[20,6,6,5,4,2,2],
};
console.log('\n=== H3 九族基础周产量 ===');
console.log('族'.padEnd(6)+'T1'.padStart(5)+'T2'.padStart(5)+'T3'.padStart(5)+'T4'.padStart(5)+'T5'.padStart(5)+'T6'.padStart(5)+'T7'.padStart(5));
for (const [k,v] of Object.entries(growthH3)) console.log(k.padEnd(6)+v.map(x=>String(x).padStart(5)).join(''));
console.log('\n逐档离散（九族之间）：');
for (let i=0;i<7;i++){
  const col = Object.values(growthH3).map(v=>v[i]);
  console.log(`  T${i+1}  ${Math.min(...col)} ~ ${Math.max(...col)}  = ${((Math.max(...col)/Math.min(...col)-1)*100).toFixed(0)}%`);
}

// ---------- H3 九族每周满产采购成本 ----------
const costH3 = {
  '城堡':[60,100,200,300,400,1000,3000], '壁垒':[70,120,200,250,350,850,2400],
  '塔楼':[30,130,150,350,550,1100,2000], '地狱':[50,125,200,250,500,900,2700],
  '墓园':[60,100,200,360,550,1200,1800], '地下':[50,130,250,300,500,850,2500],
  '据点':[40,100,150,300,600,750,1500], '要塞':[50,75,220,325,525,800,2200],
  '元素':[25,250,300,350,400,750,1500],
};
console.log('\n=== H3 九族"每周把产量买光"要多少金 ===');
const bills = {};
for (const k of Object.keys(costH3)) {
  bills[k] = growthH3[k].reduce((s,gr,i)=>s+gr*costH3[k][i],0);
  console.log(`  ${k}  ${String(bills[k]).padStart(6)} 金/周`);
}
const bv = Object.values(bills);
console.log(`  区间 ${Math.min(...bv)} ~ ${Math.max(...bv)} = ${((Math.max(...bv)/Math.min(...bv)-1)*100).toFixed(0)}%   （首都 28000 金/周 ⇒ 占 ${(Math.min(...bv)/28000*100).toFixed(0)}%~${(Math.max(...bv)/28000*100).toFixed(0)}%）`);

// ---------- 我们：四族 ----------
const ours = {
  p1:[[14,20],[5,110],[4,240],[3,520],[2,1300]],
  p2:[[12,30],[5,120],[4,230],[3,520],[2,1250]],
  p3:[[10,25],[5,115],[4,260],[3,540],[2,1300]],
  p4:[[9,25],[5,115],[4,250],[3,540],[2,1300]],
};
console.log('\n=== 我们四族基础周产量 ===');
for (const [k,v] of Object.entries(ours)) console.log(`  ${k}  ${v.map(x=>x[0]).join(' / ')}`);
console.log('  逐档离散：T1 ' + ((14/9-1)*100).toFixed(0) + '%  T2 0%  T3 0%  T4 0%  T5 0%');

console.log('\n=== 我们四族"每周把产量买光"要多少金 ===');
const ob = {};
for (const [k,v] of Object.entries(ours)) {
  ob[k] = v.reduce((s,[gr,c])=>s+gr*c,0);
  console.log(`  ${k}  ${String(ob[k]).padStart(6)} 金/周`);
}
const ov = Object.values(ob);
console.log(`  区间 ${Math.min(...ov)} ~ ${Math.max(...ov)} = ${((Math.max(...ov)/Math.min(...ov)-1)*100).toFixed(1)}%`);
console.log('  满建筑城镇收入 1450 金/日 = 10150 金/周 ⇒ 占 ' + (Math.min(...ov)/10150*100).toFixed(0) + '%~' + (Math.max(...ov)/10150*100).toFixed(0) + '%');

// ---------- 我们 T5 的镜像表 ----------
const t5 = [
  ['天使',  9,9,'10-14',60,8,2,1300,864],
  ['恶魔', 11,7,'12-16',52,9,2,1250,946],
  ['绿龙', 11,9,'10-14',60,7,2,1300,936],
  ['摄魂怪',10,8,'10-13',60,9,2,1300,863],
];
console.log('\n=== 我们的五级兵（对镜 H3 七级兵）===');
console.log('兵种'.padEnd(10)+'攻/防'.padEnd(8)+'HP'.padEnd(5)+'速'.padEnd(4)+'周产'.padEnd(5)+'单价'.padEnd(7)+'满产金'.padEnd(8)+'每周战力'.padEnd(9)+'每金战力');
for (const [n,a,d,dm,hp,sp,gr,c,pw] of t5) {
  console.log(n.padEnd(10)+`${a}/${d}`.padEnd(8)+String(hp).padEnd(5)+String(sp).padEnd(4)+String(gr).padEnd(5)+String(c).padEnd(7)+String(gr*c).padEnd(8)+String(pw*gr).padEnd(9)+(pw/c).toFixed(3));
}
const effs = t5.map(r=>r[8]/r[7]);
console.log(`  每金战力 ${Math.min(...effs).toFixed(3)} ~ ${Math.max(...effs).toFixed(3)} = ${((Math.max(...effs)/Math.min(...effs)-1)*100).toFixed(0)}%  (H3 七级 26%)`);
console.log(`  单价 ${Math.min(...t5.map(r=>r[7]))} ~ ${Math.max(...t5.map(r=>r[7]))} = ${((Math.max(...t5.map(r=>r[7]))/Math.min(...t5.map(r=>r[7]))-1)*100).toFixed(0)}%  (H3 七级 100%)`);
console.log(`  每周战力 ${Math.min(...t5.map(r=>r[8]*r[6]))} ~ ${Math.max(...t5.map(r=>r[8]*r[6]))} = ${((Math.max(...t5.map(r=>r[8]*r[6]))/Math.min(...t5.map(r=>r[8]*r[6]))-1)*100).toFixed(0)}%  (H3 八族 61%)`);
