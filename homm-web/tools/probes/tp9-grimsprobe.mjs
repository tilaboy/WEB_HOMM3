#!/usr/bin/env node
/**
 * tp9-grimsprobe.mjs —— TP-9② 一次性探针（设计取证，非门控；置于 probes/ 与其它
 * 一次性探针同规矩）。读数记录在 `production/tp9-differentiation-design.md` §2.1
 * （绑构建指纹 0e4cf35dc88b / 133 文件，2026-10-15 跑）。
 *
 * 量《破碎罗盘》grims-showcase（40×40 · 3 对手 · rush）的：
 *   · 地形构成 · 四家主城位 · p1 英雄起点
 *   · 以 p1 起点算真实路径消耗，把全部物件按「1/2/3 天可达」分带
 *   · 每带的野怪档位 / 战力（races.md §1.2 口径）/ 资源堆 / 宝箱 / 矿 / 宝库
 *   · p1 到三家 AI 主城的路径消耗（AI 压力曲线的几何输入）
 * 读数绑构建：跑前打 dist 指纹。
 */
import { createGame } from '/Users/lichao/Workbuddy/2026-09-12-11-57-32/homm-web/dist/core/map/generator.js';
import { computePaths } from '/Users/lichao/Workbuddy/2026-09-12-11-57-32/homm-web/dist/core/map/pathfinding.js';
import { UNITS } from '/Users/lichao/Workbuddy/2026-09-12-11-57-32/homm-web/dist/core/data/units.js';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = '/Users/lichao/Workbuddy/2026-09-12-11-57-32/homm-web/dist';
function fingerprint(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  files.sort();
  const h = createHash('sha256');
  for (const f of files) h.update(readFileSync(f));
  return { n: files.length, sha256: h.digest('hex').slice(0, 12) };
}
console.log('dist fingerprint:', JSON.stringify(fingerprint(DIST)));

const cfg = { size: 'large', layout: 'wild', seed: 2175, opponents: 3, difficulty: 'normal', scenario: 'grims-showcase' };
const state = createGame(cfg);
const m = state.map;
console.log(`map ${m.width}x${m.height} day=${state.day}`);

// 地形构成
const terr = {};
for (let i = 0; i < m.width * m.height; i++) terr[m.tiles[i].terrain] = (terr[m.tiles[i].terrain] ?? 0) + 1;
console.log('terrain:', JSON.stringify(terr));

// 主城与英雄
const towns = Object.values(m.objects).filter((o) => o.kind === 'town');
for (const t of towns) {
  const tp = state.towns[t.payload.townId];
  console.log(`town ${t.id} owner=${tp?.owner ?? '?'} pos=(${t.pos.x},${t.pos.y})`);
}
const heroes = Object.values(state.heroes);
const p1 = heroes.find((h) => h.owner === 'p1');
console.log(`p1 hero ${p1.id} at (${p1.pos.x},${p1.pos.y}) movePoints=${p1.movePoints}`);
const MOVE = p1.movePoints; // normal = 1800
console.log(`p1 每日移动力 = ${MOVE}`);

// 战力口径（races.md §1.2）
function power(army) {
  let p = 0;
  for (const s of army) {
    const u = UNITS[s.unitTypeId];
    if (!u) { console.log('  ?unknown unit', s.unitTypeId); continue; }
    const avg = (u.damageMin + u.damageMax) / 2;
    p += avg * u.hp * s.count * Math.max(0.3, Math.min(3, 1 + 0.05 * (u.attack - 5)));
  }
  return Math.round(p);
}

const pf = computePaths(state, p1.pos);
const costAt = (x, y) => pf.cost[y * m.width + x];

// 分带
const bands = [
  { name: 'D1 (≤' + MOVE + ')', max: MOVE },
  { name: 'D2 (≤' + MOVE * 2 + ')', max: MOVE * 2 },
  { name: 'D3 (≤' + MOVE * 3 + ')', max: MOVE * 3 },
  { name: 'D4+', max: Infinity },
];
const bandOf = (c) => bands.find((b) => c <= b.max) ?? bands[bands.length - 1];

const rows = {};
for (const o of Object.values(m.objects)) {
  if (o.kind === 'town' || o.kind === 'obstacle') continue;
  const c = costAt(o.pos.x, o.pos.y);
  const b = bandOf(c).name;
  rows[b] ??= { pile: 0, chest: 0, artifact: 0, fountain: 0, monWeak: 0, monMid: 0, monStrong: 0, monPower: 0, mineOwned: 0, mineFree: 0, vault: 0, vaultPower: 0 };
  const r = rows[b];
  if (o.kind === 'resourcePile') r.pile++;
  else if (o.kind === 'treasureChest') r.chest++;
  else if (o.kind === 'artifact') r.artifact++;
  else if (o.kind === 'fountain') r.fountain++;
  else if (o.kind === 'wanderingMonster') {
    r['mon' + o.payload.tier[0].toUpperCase() + o.payload.tier.slice(1)]++;
    r.monPower += power(o.payload.army);
  } else if (o.kind === 'mine') {
    if (o.payload.owner === 'p1') r.mineOwned++; else r.mineFree++;
  } else if (o.kind === 'vault') {
    r.vault++;
    r.vaultPower += power(o.payload.army);
  }
}
console.log('\n=== p1 视角分带（D=天，路径消耗口径）===');
console.log('band | pile chest art fount | weak mid strong 怪战力 | mine(我方/空) vault 库战力');
for (const b of bands) {
  const r = rows[b.name];
  if (!r) { console.log(`${b.name} | —`); continue; }
  console.log(`${b.name} | ${r.pile} ${r.chest} ${r.artifact} ${r.fountain} | ${r.monWeak} ${r.monMid} ${r.monStrong} ${r.monPower} | ${r.mineOwned}/${r.mineFree} ${r.vault} ${r.vaultPower}`);
}

// p1 主城 → 三家 AI 主城的路径消耗
const p1town = towns.find((t) => state.towns[t.payload.townId]?.owner === 'p1');
console.log('\n=== p1 主城到各 AI 主城（路径消耗 → 天数）===');
for (const t of towns) {
  const owner = state.towns[t.payload.townId]?.owner;
  if (owner === 'p1') continue;
  const pf2 = computePaths(state, t.pos);
  // 反测：从 AI 城算到 p1 城
  const c = pf2.cost[p1town.pos.y * m.width + p1town.pos.x];
  const days = c === Infinity ? 'unreachable' : (c / MOVE).toFixed(1) + 'd';
  console.log('AI ' + owner + ' town (' + t.pos.x + ',' + t.pos.y + ') -> p1 town: cost=' + (c === Infinity ? 'inf' : Math.round(c)) + ' ~= ' + days);
}

// 野怪总战力按档（全图）
const mons = Object.values(m.objects).filter((o) => o.kind === 'wanderingMonster');
const byTier = { weak: 0, mid: 0, strong: 0 };
const powByTier = { weak: 0, mid: 0, strong: 0 };
for (const mo of mons) { byTier[mo.payload.tier]++; powByTier[mo.payload.tier] += power(mo.payload.army); }
console.log('\n=== 全图野怪 ===', JSON.stringify(byTier), '战力:', JSON.stringify(powByTier));
const mines = Object.values(m.objects).filter((o) => o.kind === 'mine');
console.log('矿场总数:', mines.length, '按资源:', JSON.stringify(mines.reduce((a, x) => ({ ...a, [x.payload.resource]: (a[x.payload.resource] ?? 0) + 1 }), {})));
const vaults = Object.values(m.objects).filter((o) => o.kind === 'vault');
console.log('宝库数:', vaults.length, '档位:', JSON.stringify(vaults.map((v) => v.payload.tier)));

// === 补充：D1/D2 带物件明细 ===
console.log('\n=== D1/D2 带明细（p1 视角）===');
for (const o of Object.values(m.objects)) {
  if (o.kind === 'town' || o.kind === 'obstacle') continue;
  const c = costAt(o.pos.x, o.pos.y);
  if (c > MOVE * 2) continue;
  let desc = o.kind;
  if (o.kind === 'wanderingMonster') {
    desc = 'mon:' + o.payload.tier + '[' + o.payload.army.map((s) => s.count + 'x' + s.unitTypeId).join(',') + ']' + (o.payload.guard ? ' guard=' + JSON.stringify(o.payload.guard) : '');
  } else if (o.kind === 'mine') desc = 'mine:' + o.payload.resource + '/' + o.payload.perDay + '/owner=' + o.payload.owner;
  else if (o.kind === 'resourcePile') desc = 'pile:' + o.payload.resource + 'x' + o.payload.amount;
  else if (o.kind === 'treasureChest') desc = 'chest:' + o.payload.gold + (o.payload.artifactId ? '+' + o.payload.artifactId : '');
  else if (o.kind === 'vault') desc = 'vault:' + o.payload.tier + '[' + o.payload.army.map((s) => s.count + 'x' + s.unitTypeId).join(',') + ']';
  console.log('  cost=' + Math.round(c) + ' (' + (c / MOVE).toFixed(2) + 'd) (' + o.pos.x + ',' + o.pos.y + ') ' + desc);
}

// === TP-11 验收：每玩家 D1 带强怪 = 0 + 每玩家 D1 带 ≥ 1 座金矿 ===
// 约束本身对四家同时生效（生成器用全部 homeSpots 的最小代价场）⇒ 验收也要四家都量。
console.log('\n=== TP-11 每玩家 D1 带验收 ===');
let g1ok = true;
let g2ok = true;
for (const h of Object.values(state.heroes)) {
  const pf = computePaths(state, h.pos);
  const d1 = Object.values(m.objects).filter((o) => {
    const c = pf.cost[o.pos.y * m.width + o.pos.x];
    return Number.isFinite(c) && c <= MOVE;
  });
  const strongs = d1.filter((o) => o.kind === 'wanderingMonster' && o.payload.tier === 'strong');
  const golds = d1.filter((o) => o.kind === 'mine' && o.payload.resource === 'gold');
  if (strongs.length) g1ok = false;
  if (golds.length < 1) g2ok = false;
  console.log('  ' + h.owner + ' 英雄(' + h.pos.x + ',' + h.pos.y + ') D1: strong=' + strongs.length + ' | gold=' + golds.length + ' [' + golds.map((o) => '(' + o.pos.x + ',' + o.pos.y + ')').join(' ') + ']');
}
console.log(g1ok ? '✅ G1 每玩家 D1 带强怪 = 0' : '❌ G1 未达标（有玩家的 D1 带落有 strong）');
console.log(g2ok ? '✅ G2 每玩家 D1 带金矿 ≥ 1' : '❌ G2 未达标（有玩家的 D1 带无金矿）');
if (!g1ok || !g2ok) process.exit(1);
