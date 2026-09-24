import { readFileSync, readdirSync } from 'node:fs';
import * as L from './lib.mjs';
const dir = 'assets/ai-drafts';
const f = readdirSync(dir).filter(x=>/full_body/.test(x))[0];
const img = L.decodePng(readFileSync(`${dir}/${f}`));
console.log('dims', img.width + 'x' + img.height);
// 检测块尺寸：沿一条穿过主体的水平线，统计相邻像素"大量相同"的行程长度众数
function runLengths(y) {
  const runs = new Map();
  let run = 1;
  const px = (x) => { const i=(y*img.width+x)*4; return (img.rgba[i]<<16)|(img.rgba[i+1]<<8)|img.rgba[i+2]; };
  for (let x = 1; x < img.width; x++) {
    if (px(x) === px(x-1)) run++; else { runs.set(run, (runs.get(run)??0)+1); run = 1; }
  }
  return runs;
}
const agg = new Map();
for (const y of [Math.floor(img.height*0.3), Math.floor(img.height*0.5), Math.floor(img.height*0.7)]) {
  for (const [len,n] of runLengths(y)) if (len>1) agg.set(len,(agg.get(len)??0)+n);
}
const top = [...agg].sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log('run-length 众数（>1px 的行程）:', top.map(([l,n])=>`${l}px×${n}`).join('  '));
const gcdLike = top.map(([l])=>l);
console.log('⇒ 最可能的块尺寸（与 1024/8=128、1024/16=64 对齐的）:', gcdLike.filter(l=>l>=6&&l<=32));
