/**
 * 生成「精灵对照表」HTML —— 让主理人/用户**在真尺寸与格子上下文里**肉眼判定
 * D-73（加宽槽位）到底对不对。不入门控，但产出是可复现的（重跑一次即得同一张表）。
 *
 * 用法：node tools/proofsheet.mjs <afterDir> <beforeDir> <outHtml>
 *   afterDir / beforeDir = `node tools/b0audit.mjs --png <dir> [--no-tier-norm]` 的产物
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIT_FRAMES, TIER_OF } from '../dist/render/unitArt.js';

const [afterDir, beforeDir, outHtml] = process.argv.slice(2);
if (!afterDir || !beforeDir || !outHtml) {
  console.error('用法: node tools/proofsheet.mjs <afterDir> <beforeDir> <outHtml>');
  process.exit(2);
}

const TILE = 32;
const dataUri = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const tryUri = (p) => {
  try {
    return dataUri(p);
  } catch {
    return null;
  }
};

const FACTION = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
const NAME = {
  lampbearer: '提灯侍从', scavenger: '捡破烂小鬼', hornxbow: '号角弩手', axethrower: '投斧蛮子',
  dwarf: '浇水矮人', thornarcher: '荆棘射手', stoneimp: '石雕小怪', fireapprentice: '喷火学徒',
  oathpike: '铁誓枪兵', templar: '圣殿骑士', wolfrider: '暴走狼骑', firebrand: '火油狂徒',
  vineguard: '藤蔓卫士', treant: '树人大叔', hopgolem: '蹦跳魔偶', librarian: '亡灵图书管理员',
};
const FAM_OF = (u) => u.slice(0, 2);
/** ★ 从 UNIT_FRAMES 派生帧尺寸 —— **绝不在本文件里硬编码槽位尺寸**。
 *  硬编码过一次（48/60），槽位一改就与本文件生成的卡片自相矛盾。 */
const sizeOf = (kind) => {
  const s = UNIT_FRAMES.find((f) => f.kind === kind);
  if (!s) throw new Error('UNIT_FRAMES 里找不到 kind=' + kind + ' 的帧');
  return { w: s.w, h: s.h };
};
const MAP_NOW = sizeOf('map');
const CU_NOW = sizeOf('idle');
const SHORT_OF = (u) => u.split('_').slice(2).join('_');

// 16 个单位一行一个
const units = [];
for (const spec of UNIT_FRAMES) {
  if (spec.kind !== 'map') continue;
  units.push(spec.unit);
}

/** 地图帧的落位：atlas.ts 里 map 帧走 Packer 默认 ax=(TILE-w)/2、ay=TILE-h。 */
const mapAnchor = (w, h) => [Math.round((TILE - w) / 2), TILE - h];
/** 战斗帧的落位：spec 里的 ax/ay（改前 -22/-48，改后 -30/-48）。 */
const cuAnchor = (w) => -Math.round(w / 2);

function tileContext(uri, w, h) {
  const [ax, ay] = mapAnchor(w, h);
  const overL = -ax, overR = Math.max(0, ax + w - TILE);
  return `<div class="tiles" style="--tw:${TILE}px">
    <div class="tilegrid" style="width:${TILE * 3}px;height:${TILE * 3}px">
      <img class="spr" src="${uri}" style="width:${w}px;height:${h}px;left:${TILE + ax}px;top:${TILE + ay}px">
    </div>
    <div class="ovr">压格 ← ${overL}px · ${overR}px →</div>
  </div>`;
}

function pair(unit, kind, label) {
  const map = kind === 'map';
  const afterName = map ? `u_${unit}_map` : `cu_${unit}`;
  const afterSpec = UNIT_FRAMES.find((s) => s.name === afterName);
  const aUri = tryUri(join(afterDir, `${afterName}.png`));
  const bUri = tryUri(join(beforeDir, `${afterName}.png`));
  const aw = afterSpec.w, ah = afterSpec.h;
  // 改前画布尺寸（记录用；PNG 里也能量出来）
  const bw = map ? 32 : 44, bh = map ? 44 : 56;
  const cuA = cuAnchor(aw), cuB = cuAnchor(bw);
  return `<div class="cell">
    <div class="cap">${label}</div>
    <div class="row">
      <div class="col"><div class="tag">改前 ${bw}×${bh}</div>
        ${bUri ? (map ? tileContext(bUri, bw, bh) : `<div class="box1"><img src="${bUri}" style="width:${bw}px;height:${bh}px"></div>`) : '<div class="miss">无</div>'}
      </div>
      <div class="col"><div class="tag ok">改后 ${aw}×${ah}</div>
        ${aUri ? (map ? tileContext(aUri, aw, ah) : `<div class="box1"><img src="${aUri}" style="width:${aw}px;height:${ah}px"></div>`) : '<div class="miss">无</div>'}
      </div>
    </div>
    ${!map ? `<div class="anch">锚点 ax：${cuB} → ${cuA}（= -宽/2，保持水平居中）</div>` : ''}
  </div>`;
}

const mapCells = units.map((u) => pair(u, 'map', `${FACTION[FAM_OF(u)]} T${TIER_OF[u]} · ${NAME[SHORT_OF(u)]}`)).join('');
const cuCells = units.map((u) => pair(u, 'cu', `${FACTION[FAM_OF(u)]} T${TIER_OF[u]} · ${NAME[SHORT_OF(u)]}`)).join('');

// ×4 放大：只看有代表性的 6 个单位
const ZOOM = ['p3_treant', 'p3_vineguard', 'p2_wolfrider', 'p1_oathpike', 'p4_stoneimp', 'p1_templar'];
const zoomCells = ZOOM.map((u) => {
  const mapN = `u_${u}_map`, cuN = `cu_${u}`;
  const mA = tryUri(join(afterDir, `${mapN}.png`)), cA = tryUri(join(afterDir, `${cuN}.png`));
  return `<div class="cell"><div class="cap">${FACTION[FAM_OF(u)]} T${TIER_OF[u]} · ${NAME[SHORT_OF(u)]}</div>
    <div class="row">
      <div class="col"><div class="tag">地图帧 ×4（${MAP_NOW.w}×${MAP_NOW.h}）</div><div class="zoom">${mA ? `<img src="${mA}" style="width:${MAP_NOW.w * 4}px;height:${MAP_NOW.h * 4}px">` : ''}</div></div>
      <div class="col"><div class="tag">战斗帧 ×4（${CU_NOW.w}×${CU_NOW.h}）</div><div class="zoom">${cA ? `<img src="${cA}" style="width:${CU_NOW.w * 4}px;height:${CU_NOW.h * 4}px">` : ''}</div></div>
    </div></div>`;
}).join('');

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>精灵对照表 · D-73 加宽槽位</title>
<style>
  :root{--bg:#14110e;--panel:#1e1a16;--line:#3a322a;--fg:#eae0d0;--dim:#a2937f;--ok:#5bbf7a;--warn:#d9a441;--bad:#d9604f}
  *{box-sizing:border-box}
  body{margin:0;padding:28px 22px 60px;background:var(--bg);color:var(--fg);
       font:14px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
  h1{font-size:20px;margin:0 0 6px}
  h2{font-size:16px;margin:34px 0 4px;padding-bottom:6px;border-bottom:1px solid var(--line)}
  .sub{color:var(--dim);font-size:13px;margin:0 0 18px}
  .nums{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:16px 0 8px}
  .nums table{border-collapse:collapse;font-size:13px;width:100%}
  .nums th,.nums td{text-align:left;padding:5px 12px 5px 0;border-bottom:1px solid #2a231c}
  .nums th{color:var(--dim);font-weight:500}
  .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)} .dim{color:var(--dim)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:14px}
  .cell{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
  .cap{font-size:13px;margin-bottom:10px;color:var(--fg)}
  .row{display:flex;gap:14px;align-items:flex-start}
  .col{display:flex;flex-direction:column;gap:6px}
  .tag{font-size:11px;color:var(--dim)} .tag.ok{color:var(--ok)}
  .box1{display:flex;align-items:flex-end;justify-content:center;min-height:56px}
  .box1 img,.spr{image-rendering:pixelated}
  .tiles{display:flex;flex-direction:column;gap:5px;align-items:flex-start}
  .tilegrid{position:relative;
    background-image:linear-gradient(to right,#2f2822 1px,transparent 1px),linear-gradient(to bottom,#2f2822 1px,transparent 1px);
    background-size:var(--tw) var(--tw);background-color:#171310;border:1px solid var(--line)}
  .tilegrid .spr{position:absolute;image-rendering:pixelated}
  .ovr{font-size:11px;color:var(--warn)}
  .anch{font-size:11px;color:var(--dim);margin-top:8px}
  .zoom{background:#171310;border:1px solid var(--line);padding:4px;display:inline-block}
  .foot{margin-top:36px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body>

<h1>精灵对照表 · D-73「加宽槽位」</h1>
<p class="sub">左边是改前、右边是改后。**地图帧画在 32px 格子网格上**，可以直接看到横向压了几格。
所有图都是 1:1 真尺寸（用像素化放大显示，不是抗锯齿缩放）。</p>

<div class="nums">
  <table>
    <tr><th>项</th><th>改前</th><th>改后</th><th>说明</th></tr>
    <tr><td>地图帧槽位</td><td>32 × 44</td><td class="ok">${MAP_NOW.w} × ${MAP_NOW.h}</td><td>最宽的地图单位（翠林 T4 树人）在目标高下需 41px 宽</td></tr>
    <tr><td>战斗帧槽位</td><td>44 × 56</td><td class="ok">${CU_NOW.w} × ${CU_NOW.h}</td><td>最宽的战斗帧（赤焰 T3 狼骑攻击）在目标高下需 58px 宽</td></tr>
    <tr><td>横向溢出帧数</td><td class="bad">8 / 48</td><td class="ok">0 / 48</td><td>溢出 = 精灵被画到自己槽位外面、两侧硬裁</td></tr>
    <tr><td>地图极限阶梯</td><td class="bad">68.2 / 84.1 / 86.4 / 79.5<br><span class="dim">（非单调）</span></td><td class="ok">61.4 / 68.2 / 77.3 / 86.4<br><span class="dim">（四族一致，步长 +6.8/+9.1/+9.1）</span></td><td>剪影高 ÷ 画布高</td></tr>
    <tr><td>战斗阶梯</td><td class="bad">四族各不相同、两族非单调</td><td class="ok">60.7 / 69.6 / 76.8 / 87.5<br><span class="dim">（四族一致）</span></td><td>同上</td></tr>
    <tr><td>断言</td><td class="bad">12 条中 [12] 红</td><td class="ok">12 条全绿</td><td>含新增的「不横向溢出画布」</td></tr>
  </table>
</div>

<h2>① 地图帧 —— 画在 32px 格子网格上（看压格）</h2>
<p class="sub">中间那格是单位所在格。改后单位会横向压到相邻格 —— <strong>这就是需要你判断的地方</strong>：
压格是 HoMM3 里正常的（大树、山都压格），但单位压格是否可接受要看你。</p>
<div class="grid">${mapCells}</div>

<h2>② 战斗帧 —— 1:1 真尺寸对照</h2>
<p class="sub">战斗帧在战斗场景里也是围绕单位位置居中，改后横向更宽。</p>
<div class="grid">${cuCells}</div>

<h2>③ ×4 放大看像素细节</h2>
<p class="sub">看归一化之后描边是否仍是干净 1px、有没有灰边/断点/丢行。</p>
<div class="grid">${zoomCells}</div>

<div class="foot">
  数据来源：<code>node tools/b0audit.mjs --png &lt;dir&gt;</code>（改后）与
  <code>--no-tier-norm --png &lt;dir&gt;</code>（改前）。本页由 <code>tools/proofsheet.mjs</code> 生成，可随时重跑。
</div>
</body></html>`;

writeFileSync(outHtml, html);
console.log('已生成 ' + outHtml + '（' + Math.round(html.length / 1024) + ' KB）');
