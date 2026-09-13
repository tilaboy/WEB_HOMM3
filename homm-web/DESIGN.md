# 《魔法门之英雄无敌 II》风格网页策略游戏 — 项目设计文档

版本 v1.2 ｜ 状态：M1、M2 已交付 ｜ 目标：分 4 个里程碑交付一个可在浏览器里玩通的完整策略游戏

---

## 一、项目目标与范围

复刻 HOMM2 的核心循环：**探索地图 → 积累资源与军队 → 攻城略地 → 英雄成长**。

### 设计原则

| 原则 | 说明 |
|---|---|
| 逻辑与渲染分离 | `core/` 是纯 TypeScript、零 DOM 依赖的规则引擎；`render/` 与 `ui/` 只负责画。好处：战斗解算器可以在无动画模式下跑（M1 的"预估损失"就是这么来的），M3 只做可视化接入。 |
| 数据驱动 | 兵种、建筑、宝物、魔法、地形全部是配置表（`core/data/*.ts`），加内容不改代码。 |
| 无美术依赖可跑 | 所有图形先用 Canvas 程序化绘制 + 纯色/几何图形占位，后续可无缝替换为真素材。 |
| 纯前端、可存档 | 无后端，状态存 `localStorage`，单页面可离线玩。 |

### 明确不做（本期）

- 多人/AI 势力对抗（M1–M4 只做**一个玩家 + 中立野怪 + 空城/敌城占位**，M5 再考虑 AI 领主）
- 士气 / 幸运 / 英雄技能树 / 外交（列入"后续扩展"）
- 音效与动画特效（留接口，不实现）

---

## 二、技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite | 冷启动快，配置为零，TS 开箱即用 |
| 语言 | TypeScript（strict） | 数据模型重（英雄/兵种/建筑/魔法互相引用），类型是刚需 |
| 地图渲染 | Canvas 2D | 格子数量多、需缩放/平移/迷雾遮罩，DOM 扛不住 |
| UI 层 | 原生 HTML + CSS 覆盖层 | HOMM2 的 UI 是大量固定面板（资源栏、英雄面板、城建窗口），DOM 比 Canvas 好维护 10 倍 |
| 状态管理 | 单个 `GameState` 对象 + 事件总线 | 规模不需要 Redux；`core/events.ts` 负责通知 UI 刷新 |
| 地图视角 | **2:1 等距菱形**（斜 45°） | ✅ 已确认。视觉目标对齐《The Battle of Polytopia》：扁平色块 + 方块"挤出厚度"的 low-poly 感，不要精细贴图。等距只影响渲染层，`core/` 逻辑仍按矩形网格运算 |
| 存档 | `localStorage` + JSON 序列化 | 版本号字段 `saveVersion`，反序列化时做迁移 |

**为什么不用 React/Vue**：本项目 95% 的屏幕面积是一张 Canvas，剩下的是十来个模态面板。引入框架带来的收益远小于它增加的心智负担。

---

## 三、里程碑路线（对应你的四步）

| 里程碑 | 内容 | 产出（可玩闭环） |
|---|---|---|
| **M1** 探索 | 等距地图生成、英雄、**弓手（单一兵种）**、移动与寻路、迷雾、地图交互（野怪/宝物/泉水/资源）、**无动画战斗解算 → 预估损失** | 能操控英雄在 24×24 地图上跑一整天，打野、捡钱、喝泉水 |
| **M2** 城建 | 资源系统、城镇建筑树、兵种生产与周增长、多兵种解锁 | 能占城 → 造兵营 → 攒兵 → 滚雪球 |
| **M3** 战斗 | 战斗场景（六边形/方格战场）、回合制指令、伤害公式、英雄攻防加成 | 打野变成一场可操作的真战斗 |
| **M4** 魔法 | 魔法书、魔法值、战斗魔法 + 冒险魔法 | 英雄从"数值挂件"变成"战术核心" |

每个里程碑都是**独立可玩**的：M1 结束时游戏就已经是一个完整的小游戏了。

---

## 四、核心数据模型

### 4.1 资源

```ts
type ResourceKind = 'gold' | 'wood' | 'ore' | 'gem' | 'crystal' | 'sulfur' | 'mercury';
type ResourceBag = Partial<Record<ResourceKind, number>>;  // 金币量大，木石次之，稀有资源个位数
```

M1 只用 `gold`；M2 城建时启用 `wood`/`ore`；稀有资源留给 M4 的魔法行会与高级建筑。

### 4.2 兵种与军队

```ts
interface UnitType {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;        // 1 最弱
  attack: number;
  defense: number;
  damageMin: number;
  damageMax: number;
  hp: number;
  speed: number;                   // 战场行动顺序 + 地图移动加成
  shots?: number;                  // 有值 = 远程
  isFlying?: boolean;
  growthPerWeek: number;           // 城镇周增长基数
  cost: ResourceBag;
  spriteKey: string;               // 程序化绘制用的图元标识
}

interface Stack {                  // 英雄军队里的"一坨"兵
  unitTypeId: string;
  count: number;
}

type Army = Stack[];               // 最多 5 个 slot（HOMM 传统）
```

**M1 只配 1 个兵种：`Archer 弓手`** ✅ 已确认

```ts
{ id: 'archer', name: '弓手', tier: 2,
  attack: 4, defense: 2, damageMin: 2, damageMax: 3,
  hp: 10, speed: 4, shots: 12,
  growthPerWeek: 5, cost: { gold: 100 } }
```

选弓手而非农民的理由：农民（ATK 1/HP 3）打初级野怪都要掉一大半兵，M1 第一小时的体验会很挫败；弓手是远程单位，能让玩家第一天就体会到"站位"的乐趣，也顺带验证了远程逻辑，M3 做战斗场景时省事。

M2 补齐 5 级：`弓手 → 枪兵 → 骑士 → 天使`（数值对齐 HOMM2 骑士城，略有简化，农民降为 tier 1 可造但不再作为起手兵）。

### 4.3 英雄

```ts
interface Hero {
  id: string;
  name: string;
  heroClass: 'knight' | 'sorceress';       // M1 先给骑士
  level: number;
  exp: number;
  primary: { attack: number; defense: number; spellPower: number; knowledge: number };
  mana: number; manaMax: number;           // M4 启用
  movePoints: number; movePointsMax: number;
  army: Army;
  artifacts: Artifact[];                   // 上限 14（HOMM 传统）
  spells: string[];                        // M4 启用
  pos: { x: number; y: number };
  owner: PlayerId;
}
```

**主属性规则**（HOMM2 风格）：
- 攻击力 = 给全军 `+N` 攻击，防御力 = 给全军 `+N` 防御
- 升级：每级随机 +1 到某一主属性；经验阈值 `100 * level * 1.2^(level-1)`
- 升级时弹出 2 选 1 的属性/技能选择（M1 简化为随机 + 提示）

### 4.4 地图

```ts
type TerrainKind = 'grass' | 'dirt' | 'sand' | 'snow' | 'swamp' | 'water' | 'rock';

interface Tile {
  terrain: TerrainKind;
  moveCost: number;        // 草地 100 / 泥路 125 / 沙地 150 / 雪地 150 / 沼泽 175 / 水面不可通行
  objectId: string | null; // 指向 MapObject
  passable: boolean;
}

interface GameMap {
  width: number; height: number;   // M1: 32 × 32
  tiles: Tile[];                   // 一维数组，index = y * width + x
  objects: Record<string, MapObject>;
}
```

**地图尺寸**：✅ 已确认为 **24 × 24 = 576 格**（"小而精"路线）。

理由：576 格在等距视角下一屏能看全约 1/3，跑完一圈约 3–4 天，节奏紧凑不注水；同时格数足够放下 12 组野怪形成难度梯度。尺寸是 `data/` 里的配置项，随时可改 32/48 而不动逻辑。

### 4.5 地图物件（Adventure Map Objects）

统一用**可访问点（visitable）**抽象 —— 这是 HOMM 系列的精髓：所有交互都是"英雄站到那个格子上"。

```ts
type MapObjectKind =
  | 'resourcePile'    // 资源堆（金/木/石）
  | 'treasureChest'   // 宝箱：金币 或 宝物
  | 'artifact'        // 地面宝物（有守卫）
  | 'fountain'        // 泉水：当日移动力 +X
  | 'wanderingMonster'// 野怪：战斗
  | 'town'            // 城镇
  | 'mine'            // 矿场：占领后每日产资源
  | 'dwelling'        // 野外招募点
  | 'obstacle'        // 树/山/岩石：纯阻挡装饰
  ;

interface MapObject {
  id: string;
  kind: MapObjectKind;
  pos: { x: number; y: number };
  payload: object;        // 按 kind 变化：野怪存 Army，宝箱存 gold/artifactId，矿场存 kind+daily
  once: boolean;          // 访问后是否消失（宝箱 true，城镇 false）
  visitedBy: PlayerId[];
}
```

**M1 地图物件配比**（24×24 = 576 格，水域约 15%，陆地约 490 格）

| 物件 | 数量 | 说明 |
|---|---|---|
| 野怪 | 12 | 分 3 档难度（弱/中/强），随距出生点距离递增；4 弱 / 5 中 / 3 强 |
| 宝箱 | 8 | 1000–3000 金，20% 概率给宝物 |
| 资源堆 | 24 | 金堆 / 木堆 / 石堆，各 8 |
| 泉水 | 3 | 当日移动力 +50% |
| 城镇 | 2 | 1 座己方起始城 + 1 座中立城（M2 后可攻占） |
| 障碍 | ~70 | 树/岩石/山，纯装饰 + 阻挡 |

### 4.6 城镇（M2）

```ts
interface Town {
  id: string;
  name: string;
  pos: { x: number; y: number };
  owner: PlayerId | 'neutral';
  buildings: Set<string>;
  garrison: Army;                       // 驻军
  growthPool: Record<string, number>;   // 未招募的累积兵（每周刷新）
  buildQueueLockedOnDay: number;        // 每天只能造 1 座
}

interface Building {
  id: string; name: string;
  cost: ResourceBag;
  requires: string[];      // 前置建筑
  effects: BuildingEffect[]; // 产金 / 解锁兵种 / 提高增长 / 加防御
}
```

**建筑树（M2 已实现，共 12 座，酒馆预置）**

```
Tavern 酒馆（预置）
  └─ 每周可招募 1 位英雄（2500 金）
Marketplace 市场 (500g + 5wood)
  └─ 资源交易：1000 金 → 5 木/矿；5 木/矿 → 500 金
Town Hall 议事堂 (1500g + 10wood + 5ore)
  └─ 每日 +250 金
Fortification 城防线（防御取最高档，不叠加）
  ├─ 木栅 (1000g + 10wood)        → 驻军 DEF +2，每日 +100 金
  ├─ 石墙 (2500g + 10ore)         → 驻军 DEF +4，每日 +200 金
  └─ 堡垒 (5000g + 10wood + 15ore) → 驻军 DEF +6，每日 +400 金，全城周增长 +25%
Dwelling 兵营（每兵种一级，周增长可叠加累积）
  ├─ 农舍 (300g + 5wood)          → 解锁农民，+10/周
  ├─ 射箭场 (1000g + 5wood + 5ore) → 解锁弓手，+5/周
  ├─ 兵营 (2500g + 10ore)         → 解锁枪兵，+4/周
  ├─ 马厩 (5000g + 10wood + 10ore) → 解锁骑士，+3/周
  └─ 圣殿 (9000g + 10wood + 20ore) → 解锁天使，+2/周
```

**周增长规则**：每周一（第 8、15、22…天），`growthPool[unit] += Σ(各兵营 baseGrowth) × (1 + 堡垒 25%)`，兵在池中**累积**直到被招募。招募时按 `unit.cost × 数量` 扣金币，从 pool 扣减。英雄部队上限 5 个兵种槽位（HOMM 规则）。

**城镇税收**：每座己方城每日基础 +500 金，加上议事堂/城墙线的加成。

**攻占中立城**：走进中立城 → 弹「预估损失」攻城确认框（守军含城墙防御加成）→ 胜则城镇易主、驻军清空、自动补上酒馆并可开始建设；空城可直接接管。

### 4.7 宝物（M1 起）

```ts
interface Artifact { id: string; name: string; slot: 'weapon'|'shield'|'helm'|'armor'|'ring'|'misc'; mods: Partial<HeroPrimary>; }
```

M1 给 6 件：`+1 攻 之剑 / +1 防 之盾 / +2 攻 / +2 防 / 移动力 +10% 之靴 / 每日 +500 金 之钱袋`。装备走"穿上即生效，脱下即失效"，槽位互斥。

---

## 五、关键系统设计

### 5.1 移动与寻路

- **移动力**：每格消耗 = `tile.moveCost`（草地 100）。英雄 `movePointsMax = 1500`（≈ 15 格草地）。对角线消耗 × 1.4。
- **寻路**：A*（8 邻域），启发函数用对角线距离。目标：点击地图任意可达格 → 计算路径 → 沿路径逐格动画移动，每步扣移动力。**遇到野怪自动停下并弹确认框**。
- **迷雾（Fog of War）**：每个玩家维护 `revealed: Uint8Array`。英雄视野半径 = `5 + 侦察术加成`。移动时实时更新。迷雾区渲染为纯黑，`explored but not visible` 区域渲染为半暗（地形可见、物件不可见）。
- **移动力恢复**：新的一天 `movePoints = movePointsMax`；泉水可临时超出上限（`overflow` 标记，第二天重置）。

### 5.2 等距渲染与坐标换算（Polytopia 风格）

**关键约定：`core/` 完全不知道等距的存在。** 逻辑层一律用 `(x, y)` 整数格子坐标，A*、迷雾、距离计算全部按矩形网格走。等距只存在于 `render/` 的一个换算函数里。

**2:1 等距换算**（菱形宽 64px、高 32px，即 `TILE_W = 64, TILE_H = 32`）

```ts
// render/iso.ts
export const TILE_W = 64, TILE_H = 32;

// 格子 → 屏幕（菱形顶点在上的中心点）
export function gridToScreen(x: number, y: number) {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) };
}

// 屏幕 → 格子（点击拾取，向下取整）
export function screenToGrid(sx: number, sy: number) {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
  return { x: Math.floor((b + a) / 2), y: Math.floor((b - a) / 2) };
}

// 菱形四顶点（用于绘制地块顶面）
export function diamond(sx: number, sy: number) {
  return [
    [sx, sy - TILE_H / 2], [sx + TILE_W / 2, sy],
    [sx, sy + TILE_H / 2], [sx - TILE_W / 2, sy],
  ];
}
```

**遮挡排序**：按 `depth = x + y` 升序绘制（y 小 x 小的先画，即"远"的先画）。物件与单位插入到所在格的深度序列里，保证站在格子上的单位盖住它后面的地形。

**视觉构成（Polytopia 的精髓：挤出厚度）**

每个地块画三部分，就能立刻有 low-poly 立体感：

```
      ◇  ← 顶面：地形主色（草地 #7FA650 / 沙地 #E0C68C / 水面 #4A90C2 ...）
    ▰▰▰▰  ← 左侧面：主色 × 0.75 暗化，高 8px（可配置 THICKNESS）
    ▰▰▰▰  ← 右侧面：主色 × 0.55 更暗
```

- 顶面边缘描 1px 半透明白，缝隙感立刻出来
- 单位/物件：不用贴图，画**几何剪影**——弓手 = 一个圆头 + 梯形身体 + 一条弧线弓，用队伍色描边区分敌我
- 选中格：顶面覆盖 30% 白色 + 描金色边框
- 可移动范围：走 A* 拿到所有 `cost <= movePoints` 的格子，顶面叠一层淡蓝

**摄像机**：`camera.ts` 维护 `{ offsetX, offsetY, zoom }`，zoom 范围 0.5–2.0，绘制时统一 `ctx.translate/scale`。屏幕坐标要先减 offset、除 zoom 再喂给 `screenToGrid`。

**性能**：576 格 × 3 面 = 1728 个多边形/帧，Canvas 2D 在手机上轻松 60fps。稳妥起见做**视口裁剪**——只画屏幕矩形外扩 2 格范围内的地块。

### 5.3 战斗解算器 —— M1 与 M3 的桥梁（核心设计）

这是整个架构最关键的一处决策：

```
combat/solver.ts   ← 纯函数：输入双方 Army + 英雄属性，输出 BattleResult（含每方剩余兵力）
     │
     ├─ M1 用法：headless 跑一遍 → 得到损失 → 弹窗显示"预估损失：轻微/中等/惨重/全灭"
     │           玩家点「确认战斗」→ 直接套用结果，无动画
     │
     └─ M3 用法：同一套 solver 改为**逐回合产出事件流**（BattleEvent[]）
                 UI 层消费事件流播动画，逻辑零改动
```

**伤害公式（HOMM2 近似）**

```ts
function computeDamage(attacker: Stack, defender: Stack, atkBonus: number, defBonus: number) {
  const A = unitType(attacker).attack + atkBonus;   // atkBonus = 英雄攻击力 + 宝物
  const D = unitType(defender).defense + defBonus;
  const base = randInt(damageMin, damageMax) * attacker.count;
  let mod = 1 + 0.05 * (A - D);
  mod = Math.min(Math.max(mod, 0.3), 3.0);          // 封顶 ±3 倍 / 0.3 倍
  if (isRanged && dist > 10) mod *= 0.5;            // 远程惩罚
  if (isRanged && adjacentEnemy) mod = 0;           // 近身不能射（需先"射击惩罚"处理）
  return Math.max(1, Math.round(base * mod));
}
```

**解算流程**（无动画版）：
1. 按 `speed` 降序建立行动序列
2. 每单位行动：远程且有弹药 → 射击；否则 → 移动到最近敌人 → 近战
3. 反击：被近战攻击且未死亡 → 反击一次（每回合限一次）
4. 直到一方全灭或跑满 20 回合（判平）

**损失分级 → 玩家提示文案**

| 损失比例 | 显示 |
|---|---|
| 0% | 完胜，无损 |
| < 15% | 轻微损失 |
| 15–40% | 中等损失 |
| 40–70% | 惨重损失 |
| > 70% | 几乎全灭 |

M1 还给玩家「**撤退**」按钮（保留 60% 兵力，英雄当日行动结束）。

### 5.4 战斗场景（M3）

| 项 | 设计 |
|---|---|
| 战场 | **12 × 10 方格**，同样用等距菱形渲染，左右两侧各一列出生区 |
| 回合制 | ATB：按 `speed` 排序的行动条，speed 高的先动；每单位每回合 1 次行动 |
| 玩家指令 | 移动 / 近战攻击 / 射击 / 防御（DEF +20%，本回合）/ 等待 / 撤退 |
| 英雄 | 不参战本体，只提供攻防加成；每回合可施法（M4） |
| 单位位置 | 堆叠占 1 格；大体积单位占 2×2（M3 先不做，列为扩展） |
| AI | 规则式：① 远程优先射最近的、② 近战冲最近的、③ 血量低于 25% 时优先攻击能一击杀的目标 |

### 5.5 魔法（M4）

```ts
interface Spell {
  id: string; name: string;
  level: 1|2|3|4|5;
  school: 'fire'|'water'|'air'|'earth';
  manaCost: number;
  target: 'enemyUnit'|'allEnemy'|'ownUnit'|'allOwn'|'tile'|'global';
  effect: object;    // 伤害值 / buff 类型 / 地图效果
  combat: boolean;   // 战斗魔法 vs 冒险魔法
}
```

**战斗魔法（12 个）**：Magic Arrow、Lightning Bolt、Fireball、Ice Bolt（伤害类）；Bless(+3 ATK)、Curse(-3 ATK)、Haste(+SPD)、Slow(-SPD)、Shield（远程伤害减半）、Bloodlust、Stone Skin、Resurrection（复活 20%/点）

**冒险魔法（6 个）**：Visions（显示野怪数量与是否加入）、View Air/View Earth（揭示地图/资源）、Town Portal（传送回城）、Dimension Door（短距传送）、Summon Boat（M4 若无水路则跳过）

**施法规则**：每日首次进入战斗 `mana = manaMax`；战斗中每回合施法 1 次；`spellPower` 影响持续回合数，`knowledge` 影响 `manaMax`（= knowledge × 10）。

---

## 六、游戏循环与回合结构

```
Day N 开始
  ├─ 所有英雄 movePoints 重置为 max（清除泉水 overflow）
  ├─ 所有己方城镇：按 Mine/建筑 产出资源进账
  ├─ 若是周一：城镇 growthPool 累加周增长
  └─ 玩家操作阶段
        ├─ 选中英雄 → 点击目标格 → 寻路移动 → 到达/触发事件
        ├─ 事件：野怪战斗 / 宝箱 / 泉水 / 资源堆 / 进城
        ├─ 进城 → 城建窗口（建造 / 招募 / 部队调度）
        └─ 点击「结束一天」→ Day N+1
```

**M1 简化**：只有 1 个英雄、1 座城、无 AI 对手，"结束一天"只做移动力重置。

---

## 七、UI 布局

```
┌────────────────────────────────────────────────────────────┐
│ 资源栏: 🪙12,450  🪵24  ⛏18  💎3  Month 1, Week 2, Day 3   │  48px
├──────────────────────────────────────────┬─────────────────┤
│                                          │  英雄列表        │
│                                          │  ┌───────────┐  │
│          地图 Canvas (等距 · 拖拽/滚轮缩放) │  │ 头像 移动力│  │
│                                          │  └───────────┘  │
│                                          ├─────────────────┤
│                                          │  选中英雄面板    │
│                                          │  攻/防/法/知     │
│                                          │  军队 5 slot     │
│                                          │  宝物 14 slot    │
├──────────────────────────────────────────┴─────────────────┤
│ [结束一天]   状态提示: 移动到 (12,7) 消耗 300 移动力         │  40px
└────────────────────────────────────────────────────────────┘
```

**交互约定（沿用 HOMM 传统）**
- 左键点己方英雄 = 选中；左键点地图 = 移动
- **右键任意元素 = 弹出信息框**（英雄/野怪/城镇/物件）
- 空格 = 居中到当前英雄；数字键 1-9 = 切换英雄；Enter = 结束一天
- 鼠标悬停格子 = 状态栏显示地形、移动消耗、剩余移动力

**触摸端映射（M1 就做进去，不留技术债）**

| 操作 | 桌面 | 手机 / 平板 |
|---|---|---|
| 平移地图 | 拖拽 / 方向键 | 单指拖 |
| 缩放 | 滚轮 / +- | 双指捏合（0.5–2.0） |
| 选中英雄 / 移动 | 左键点击 | 点击 |
| 查看信息 | 右键 | **长按 400ms** |
| 切换英雄 | 数字键 1-9 | 点顶部英雄头像条 |
| 结束一天 | Enter | 底部固定按钮 |
| 取消 / 关闭 | Esc | 点遮罩 |

布局用 CSS 媒体查询：≥ 1024px 为"地图 + 右侧 260px 面板"；< 768px 自动切成"地图 + 底部可上拉面板"，按钮最小触控区 44×44px。

**响应式断点**：`≥1024 桌面` / `768–1023 平板横屏` / `<768 手机竖屏`

**弹窗类型**：战斗预估确认 / 战报 / 宝物拾取 / 升级选择 / 城镇界面（全屏模态）/ 城建确认

---

## 八、目录结构

```
homm-web/
├── index.html                    viewport + manifest 链接
├── package.json                  vite + typescript，零运行时依赖
├── tsconfig.json                 strict: true
├── public/
│   ├── manifest.json             PWA 清单（M1 末接入）
│   ├── sw.js                     Service Worker，cache-first
│   └── icon-192.png / icon-512.png
├── src/
│   ├── main.ts                   启动：加载配置 → 建局 → 挂渲染循环
│   │
│   ├── core/                     ★ 纯逻辑层，零 DOM 依赖，可单测
│   │   ├── types.ts              所有共享类型
│   │   ├── rng.ts                可播种随机数（存档可复现）
│   │   ├── data/
│   │   │   ├── units.ts          兵种表
│   │   │   ├── heroes.ts         英雄模板 + 成长表
│   │   │   ├── buildings.ts      建筑树
│   │   │   ├── artifacts.ts      宝物表
│   │   │   ├── spells.ts         魔法表
│   │   │   ├── terrains.ts       地形移动消耗 + 配色
│   │   │   └── objects.ts        地图物件模板 + 生成权重
│   │   ├── map/
│   │   │   ├── generator.ts      柏林噪声地形 + 物件撒点
│   │   │   ├── pathfinding.ts    A*
│   │   │   └── fog.ts            视野与迷雾
│   │   ├── game/
│   │   │   ├── GameState.ts      根状态 + 序列化
│   │   │   ├── turn.ts           日/周推进
│   │   │   ├── hero.ts           移动、升级、宝物
│   │   │   ├── interaction.ts    ★ 访问地图物件的分派中心
│   │   │   ├── town.ts           建造、招募、增长
│   │   │   └── economy.ts        资源收支
│   │   ├── combat/
│   │   │   ├── damage.ts         伤害公式
│   │   │   ├── solver.ts         ★ 无头解算器（M1 与 M3 共用）
│   │   │   ├── battle.ts         有状态战斗（M3，产出事件流）
│   │   │   └── ai.ts             战斗 AI
│   │   └── events.ts             轻量事件总线
│   │
│   ├── render/
│   │   ├── iso.ts              ★ 等距坐标换算（唯一知道"等距"的地方）
│   │   ├── MapRenderer.ts      地形/物件/迷雾/路径预览 + 视口裁剪
│   │   ├── camera.ts           平移缩放
│   │   ├── sprites.ts          程序化图元（无外部素材）
│   │   └── BattleRenderer.ts   M3
│   │
│   ├── ui/
│   │   ├── HUD.ts                资源栏 + 日期
│   │   ├── HeroPanel.ts          英雄属性/军队/宝物
│   │   ├── TownScreen.ts         城镇界面（M2）
│   │   ├── BattleScreen.ts       战斗界面（M3）
│   │   ├── SpellBook.ts          M4
│   │   ├── Dialogs.ts            通用模态框
│   │   ├── InfoPopup.ts          右键信息框
│   │   └── styles.css            HOMM2 风格：石纹边框、羊皮纸色
│   │
│   └── save/
│       └── persistence.ts        localStorage 读写 + 版本迁移
```

---

## 九、里程碑验收标准

### M1 — 探索 ✅ 已交付
- [x] 24×24 **等距**地图程序生成，6 种地形 + 挤出厚度，可拖拽平移、滚轮/双指缩放
- [x] 1 个英雄、1 个兵种（**弓手**），资源栏显示金币与日期
- [x] 点击目标格 → A* 寻路 → 逐格移动动画，扣移动力；状态栏实时显示消耗
- [x] 迷雾：视野外全黑，探索过但当前不可见为半暗
- [x] 踩到野怪 → 弹「预估损失」确认框 → 确认后扣兵、给经验
- [x] 踩到宝箱 → 给金币/宝物；踩到泉水 → 移动力 +50%；踩到资源堆 → 加资源
- [x] 「结束一天」重置移动力，日期推进
- [x] 存档/读档

### M2 — 城建 ✅ 已交付
- [x] 金/木/矿三种资源生效（建筑消耗木/矿，宝石等稀有资源留给 M4 魔法行会）
- [x] 12 座建筑树（酒馆预置），前置依赖校验 + 资源校验
- [x] 5 级兵种解锁（农民/弓手/枪兵/骑士/天使）+ 周增长累积 + 招募扣费
- [x] 部队上限 5 兵种槽位；英雄 ↔ 驻军自由调度
- [x] 酒馆每周招募 1 位英雄（2500 金，最多 3 套模板轮换）；侧栏英雄切换
- [x] 市场资源交易
- [x] 可攻占中立城镇（攻城预估含城墙防御加成）；英雄可在城与野外之间调度部队
- [x] 城镇外观随建成兵营数量增加塔楼；「结束一天」结算税收，每周一结算增长

### M3 — 战斗
- [ ] 12×10 战场，ATB 行动条
- [ ] 移动/近战/射击/防御/等待/撤退 六指令
- [ ] 伤害公式接入英雄攻防加成，右键查看单位详情
- [ ] 战斗 AI 可自动打完

### M4 — 魔法
- [ ] 魔法书 UI、魔法值、施法目标选择
- [ ] 12 个战斗魔法 + 6 个冒险魔法
- [ ] 魔法行会建筑解锁对应等级法术

---

## 十、风险与对策

| 风险 | 对策 |
|---|---|
| 没有美术素材，画面太丑玩不下去 | `sprites.ts` 程序化绘制：地形用噪声纹理 + 配色，单位用几何图形 + 剪影，UI 用 CSS 做石纹/羊皮纸质感。整体走"低分辨率像素风"，丑得统一就是风格 |
| **等距坐标换算出错导致点击偏移** | `iso.ts` 只暴露 `gridToScreen` / `screenToGrid` 两个纯函数，配往返单测（随机 1000 个格子，换算去再换算回来必须相等）；拾取时先减 camera offset、再除 zoom |
| **触摸端双指缩放与页面滚动冲突** | canvas 设 `touch-action: none`，viewport 禁 `user-scalable`；长按 400ms 才触发信息框，与点击移动互斥 |
| 战斗平衡调不出来 | 所有数值集中在 `core/data/*.ts`，配一个 `balance.ts` 调参入口；M3 加"自动战斗 1000 场"的模拟脚本输出胜率矩阵 |
| 寻路在障碍密集处卡顿 | 32×32 = 1024 格，A* 最坏也在毫秒级，无需优化。真出问题再加 JPS 或预计算连通域 |
| 状态散落导致 UI 不同步 | 强制约定：UI 只读 `GameState`，所有修改走 `core/game/*` 的函数并通过事件总线广播 |
| 需求膨胀做不完 | 每个里程碑独立封版，只在该里程碑内加需求；新增需求进 backlog 排到 M5 |

---

## 十一、已确认决策记录

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 地图视角 | ✅ **2:1 等距菱形**，视觉对标 Polytopia（扁平色块 + 挤出厚度），不做精细贴图 |
| 2 | 地图尺寸 | ✅ **24 × 24**，12 组野怪，走"小而精"路线 |
| 3 | M1 起手兵种 | ✅ **弓手**（ATK 4 / DEF 2 / DMG 2-3 / HP 10 / SPD 4 / 12 发箭），弃用农民 |
| 4 | AI 对手势力 | ✅ 本期不做，只有中立野怪 + 可攻占空城，**排到 M5** |

---

## 十二、交付形态：Web + PWA（为什么不做原生 App）

### 体积与加载评估

| 项 | 估算 |
|---|---|
| 自研 JS（M1–M4 全部，零运行时依赖） | 150–250 KB 未压缩 → **gzip 后 40–70 KB** |
| HTML + CSS | < 15 KB |
| 图片 / 字体 / 音频资源 | **0**（全部程序化绘制） |
| **首屏下载总量** | **约 60–90 KB** |
| 4G 首屏可交互 | < 1 秒 |
| 单局存档 | 3–8 KB JSON（localStorage 上限 5 MB） |
| 运行时帧预算 | 576 格 × 3 面 ≈ 1728 多边形/帧，手机 60fps 无压力 |

对比参照：Flutter "Hello World" 的 Android 包 ≈ 15 MB；含素材的商业手游 100 MB–2 GB。**本项目比任何原生 App 小三个数量级**，原因就是没有美术资源包。

### 为什么 Web 优于原生 App

| 维度 | Web + PWA | 原生 App |
|---|---|---|
| 迭代速度 | 改完刷新即可 | 需重新编译打包 |
| 分发 | 一个链接 / 加到主屏幕 | 应用商店审核 |
| 跨平台 | 桌面 + iOS + Android 一套代码 | 至少两套 |
| 环境依赖 | 浏览器 + Node | Xcode / Android SDK |
| 离线可玩 | ✅ Service Worker | ✅ |
| 主屏幕图标 | ✅ Web App Manifest | ✅ |

唯一需要额外付出的，是**交互层从第一天就要同时支持鼠标和触摸**（已在 §七 给出映射表）。这个成本远小于维护两套原生工程。

### PWA 接入时机（M1 结束时，约 1 小时工作量）

```
public/
├── manifest.json       name / icons / display: standalone / theme_color
├── icon-192.png        程序化生成的图标
├── icon-512.png
└── sw.js               预缓存 index.html + 打包产物，cache-first
```

`index.html` 加 `<link rel="manifest">` 与 `navigator.serviceWorker.register('/sw.js')`；同时设 `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">` 与 `touch-action: none` 防掉双指缩放与页面滚动冲突。

### 如果将来真的想要原生 App

`core/` 是零 DOM 依赖的纯 TypeScript，可以原样打包进 Capacitor / Tauri 壳子里，渲染与 UI 层复用 WebView，改造成本极低。**先把 Web 跑通，是最省的一条路。**

---

## 十三、下一步

确认无误后，我会按以下顺序搭 M1：

1. `npm create vite` 建工程（TS + strict），写 `core/types.ts` 与 `data/` 配置表
2. `map/generator.ts` 生成 24×24 地形 + 撒物件
3. `render/iso.ts` + `MapRenderer.ts` 画出第一张等距地图（能拖拽缩放）
4. `map/pathfinding.ts` A* + 英雄点击移动 + 移动力
5. `map/fog.ts` 迷雾
6. `game/interaction.ts` 物件分派 + `combat/solver.ts` 预估损失弹窗
7. HUD / 英雄面板 / 结束一天 / 存档

