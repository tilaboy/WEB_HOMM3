// ai-value.mjs —— §25.3 的 20 个 aiValue（P2 战力 × 远程 1.25）
// 运行：node production/ui-redesign-2026-10-28/tools/ai-value.mjs
// 注意：这是**目标读数**。B1 落地时以 powerRef() 的实际输出为准，容差 ±2%。
// V6 读的是这里的两行：族级周产 aiValue 极差 9.4%、T1 37.1%。
// §16.2 新阵容；power 列直接取表内读数（P2 口径）
const U=[
 ['p1',1,'小孩',3,14,5,false],
 ['p1',2,'弩手',10,5,30,true],
 ['p1',3,'鹰',14,4,74,false],
 ['p1',4,'骑士',36,3,342,false],
 ['p1',5,'天使',65,2,1393,false],
 ['p2',1,'火柴人',3,12,6,true],
 ['p2',2,'铜人',15,5,42,false],
 ['p2',3,'三头狼',13,4,79,false],
 ['p2',4,'熔岩巨人',34,3,322,false],
 ['p2',5,'恶魔',55,2,1251,false],
 ['p3',1,'矮人',5,10,8,false],
 ['p3',2,'丛林射手',11,5,28,true],
 ['p3',3,'树人',20,4,91,false],
 ['p3',4,'猿人',30,4,293,true],
 ['p3',5,'绿龙',62,2,1164,false],
 ['p4',1,'骷髅',4,9,8,false],
 ['p4',2,'僵尸',15,5,41,false],
 ['p4',3,'吸血鬼',15,5,74,false],
 ['p4',4,'牛头怪',30,5,314,true],
 ['p4',5,'摄魂怪',60,2,932,false],
];
const R=1.25;
console.log('| 族 | 兵 | 战力(P2) | 远程 | aiValue |');
for(const [f,t,n,hp,g,p,r] of U){
  const v=Math.round(p*(r?R:1));
  console.log(`| ${f} | ${n} | ${p} | ${r?'✔ ×1.25':'—'} | **${v}** |`);
}
const fam={p1:0,p2:0,p3:0,p4:0}, hp={p1:0,p2:0,p3:0,p4:0}, pw={p1:0,p2:0,p3:0,p4:0};
for(const [f,t,n,h,g,p,r] of U){ fam[f]+=g*Math.round(p*(r?R:1)); hp[f]+=g*h; pw[f]+=g*p; }
console.log('\n每周 aiValue / hp / 纯战力');
const f4=['p1','p2','p3','p4'];
for(const f of f4) console.log(f, fam[f], hp[f], pw[f], 'ratio', (fam[f]/hp[f]).toFixed(2));
const sp=(a)=>((Math.max(...a)/Math.min(...a)-1)*100).toFixed(1)+'%';
console.log('族总 aiValue 极差', sp(f4.map(f=>fam[f])));
console.log('族总 纯战力 极差', sp(f4.map(f=>pw[f])));
// 开局 20 个 T1
console.log('\n开局（20×T1）');
for(const f of f4){ const u=U.find(x=>x[0]===f&&x[1]===1); const v=Math.round(u[5]*(u[6]?R:1)); console.log(f,'hp',20*u[3],'value',20*v,'ratio',(v/u[3]).toFixed(2)); }
// T1 周产 aiValue 极差
const t1=f4.map(f=>{const u=U.find(x=>x[0]===f&&x[1]===1);return u[4]*Math.round(u[5]*(u[6]?R:1));});
console.log('T1 周产 aiValue',t1.join('/'),'极差',sp(t1));
