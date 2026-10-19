/**
 * tp5-atkframes.mjs —— TP-5 前提探针（非门控，进 tools/probes/）。
 *
 * 验「cu_*_atk 帧已烘焙、只差渲染器接线」这个前提：
 *   A. UNIT_FRAMES 里每个 atk 帧都有配对 idle（渲染器按 `cu_<id>` / `cu_<id>_atk` 取帧）；
 *   B. idle 与 atk 的**像素确实不同**（防止"接线了但看不出变化"的空兑）；
 *   C. 反向自检：故意取一个不存在的帧名，`buildB0Frame` 必须抛错（证明构建链真的在按名取帧）。
 *
 * 读数绑构建：跑前打 dist 指纹。
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../../dist/', import.meta.url).pathname;

function distFingerprint() {
  const h = createHash('sha256');
  let n = 0;
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else { h.update(f); h.update(readFileSync(p)); n++; }
    }
  };
  walk(DIST);
  return `${h.digest('hex').slice(0, 12)} (${n} 文件)`;
}

const { UNIT_FRAMES, buildB0Frame } = await import(DIST + 'render/unitArt.js');
const { PixBuf } = await import(DIST + 'render/pixel.js');

console.log('dist 指纹: ' + distFingerprint());

let fail = 0;
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

/* A：配对完整 */
const cu = UNIT_FRAMES.filter((s) => s.kind !== 'map');
const atk = cu.filter((s) => s.name.endsWith('_atk'));
const idle = cu.filter((s) => !s.name.endsWith('_atk'));
console.log(`\n非 map 战斗帧: ${cu.length}（idle ${idle.length} / atk ${atk.length}）`);
console.log('atk 帧: ' + atk.map((s) => s.name.replace(/^cu_/, '').replace(/_atk$/, '')).join(' '));
const missing = atk.filter((a) => !idle.some((i) => i.name === a.name.replace(/_atk$/, '')));
if (missing.length) bad('缺配对 idle: ' + missing.map((m) => m.name).join(' '));
else console.log('✅ 每个 atk 都有配对 idle');

/* B：idle vs atk 像素必须不同（否则接线也看不出攻击姿态） */
console.log('\n=== idle vs atk 像素差 ===');
let sameCount = 0;
for (const a of atk) {
  const idleName = a.name.replace(/_atk$/, '');
  const pa = buildB0Frame(a.name);
  const pi = buildB0Frame(idleName);
  if (pa.w !== pi.w || pa.h !== pi.h) { bad(`${a.name} 与 ${idleName} 尺寸不同`); continue; }
  let diff = 0;
  for (let y = 0; y < pa.h; y++) {
    for (let x = 0; x < pa.w; x++) {
      const [r1, g1, b1, a1] = pa.px(x, y);
      const [r2, g2, b2, a2] = pi.px(x, y);
      if (r1 !== r2 || g1 !== g2 || b1 !== b2 || a1 !== a2) diff++;
    }
  }
  const pct = ((diff / (pa.w * pa.h)) * 100).toFixed(1);
  const unit = a.name.replace(/^cu_/, '').replace(/_atk$/, '');
  console.log(`  ${unit.padEnd(16)} 差异像素 ${String(diff).padStart(4)} / ${pa.w * pa.h} (${pct}%)`);
  if (diff === 0) { bad(`${a.name} 与 idle 完全同图 —— 接线后看不出攻击姿态`); sameCount++; }
}
if (sameCount === 0) console.log('✅ 全部 atk 帧与 idle 有可辨差异');

/* C：反向自检 —— 不存在的帧名必须抛错 */
console.log('\n=== 反向自检：不存在的帧名 ===');
try {
  buildB0Frame('cu_no_such_unit');
  bad('buildB0Frame 对不存在的帧名没有抛错');
} catch (e) {
  console.log('✅ 按预期抛错: ' + String(e.message).slice(0, 60));
}

console.log('\n' + (fail === 0 ? '✅ TP-5 前提断言全过' : `❌ ${fail} 条断言失败`));
process.exit(fail === 0 ? 0 : 1);
