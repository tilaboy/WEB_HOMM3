/** 人类玩家固定是 p1；p2~p4 是电脑对手；neutral 表示无主（中立方）。 */
export type FactionId = 'p1' | 'p2' | 'p3' | 'p4';
export type PlayerId = FactionId | 'neutral';

export type MapSize = 'small' | 'medium' | 'large' | 'huge';
export type Difficulty = 'easy' | 'normal' | 'hard';

/** 攻城器械（M6）。具体数值在 data/warmachines.ts。 */
export type WarMachineId = 'catapult' | 'ballista';

/** 难度档：只影响电脑对手，不削弱玩家（HOMM 的"AI 优势"思路）。 */
export interface DifficultyDef {
  id: Difficulty;
  name: string;
  desc: string;
  /** AI 起始资源倍率 */
  startMul: number;
  /** AI 每周增长的额外系数（0.1 = 多 10%） */
  growthBonus: number;
  /** AI 出击所需的兵力阈值倍率：越低越早出门。必须 < 4.0（否则 outward 权重系数转负） */
  aggression: number;

  /* ---------- 玩家侧（本次重设计新增） ---------- */
  /** 玩家（p1）起始资源倍率（**乘法**，1 = 基准 {2500, 10, 10}）。基准 × 此值后四舍五入。 */
  playerStartMul: number;
  /** 玩家每周增长的额外系数（**加法**，0 = 不罚，与 growthBonus 同一条代码路径）。
   *  不是倍率——0.25 表示每周多产 25% 兵，0 表示与普通档完全相同。
   *  负值为惩罚（如 −0.1 会让天使周产 2→1），已拍板不给（见决策②）。 */
  playerGrowthBonus: number;
  /** 玩家英雄每日移动力倍率（**乘法**，1 = 不罚，BASE_MOVE_POINTS = 1800 为基准）。
   *  注意：这是**移动力**倍率，不是周增长；0.9 ⇒ 困难档玩家 1620 移动力。 */
  playerMoveMul: number;
  /** 全部非玩家所属部队（野怪 / 中立城驻军 / 宝库守卫）的规模倍率（**乘法**，1 = 不变）。
   *  必须在 randInt() **之后**相乘，禁止改变 rng 调用次数与顺序 */
  monsterMul: number;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  /** 默认领主名（电脑对手用） */
  lord: string;
  /** 主城名 */
  home: string;
  color: string;
  /** 旗帜/城镇屋顶的暗色面 */
  dark: string;
}

/**
 * 地图宏观布局模板。噪声只负责"纹理"，这四档负责"结构"——
 * 水在哪、山在哪、哪块地最富庶，进游戏前就能一眼看懂这张图的打法。
 */
export type MapLayout = 'wild' | 'ring' | 'islands' | 'lanes';

/** 一局游戏的开局设置，随存档一起保存，读档后局面可完全复现。 */
export interface GameConfig {
  size: MapSize;
  seed: number;
  layout: MapLayout;
  /** 电脑对手数量 0~3 */
  opponents: number;
  difficulty: Difficulty;
  playerName: string;
  /**
   * 试玩场景 id（见 `core/data/scenarios.ts`）。**缺省 = 自由对局**：
   * 所有场景分支都不走 ⇒ 生成结果与引入场景之前**逐字节一致**
   * （`playtest-scenarios.md §4 A1` 的"零改动回滚底线"）。
   *
   * 只存 **id 字符串**（不存整个 `ScenarioDef`）⇒ 存档结构只多这一个可选字段，
   * `VERSION` 不动（§1.3 #6，与 difficulty 那次同一判断）。
   */
  scenario?: string;
}

export const MAP_SIZES: Record<MapSize, { width: number; height: number; name: string }> = {
  small: { width: 24, height: 24, name: '小型' },
  medium: { width: 32, height: 32, name: '中型' },
  large: { width: 40, height: 40, name: '大型' },
  // M9：四家各占一片、每座城都要有木石矿，40×40 开始显得挤，所以再加一档
  huge: { width: 48, height: 48, name: '巨型' },
};

export type ResourceKind = 'gold' | 'wood' | 'ore' | 'gem' | 'crystal' | 'sulfur' | 'mercury';
export type ResourceBag = Partial<Record<ResourceKind, number>>;

export interface GridPos {
  x: number;
  y: number;
}

/* ---------------- units ---------------- */

export interface UnitType {
  id: string;
  name: string;
  tier: number;
  attack: number;
  defense: number;
  damageMin: number;
  damageMax: number;
  hp: number;
  speed: number;
  shots?: number;
  expValue: number;
  growthPerWeek: number;
  cost: ResourceBag;
  /**
   * **AI 眼里的强弱**（§25.2–25.4，决策 44/63）。量纲 = **B 口径战力**（`powerRef()`），
   * **不是血量** —— 同一个概念以前用 `armyHp` 读，两把尺不能混用（`armyHp` 仍在，只给探针）。
   *
   * 远程 ×1.25（只进本字段，不进 `cost`）；飞行 / 吸血 / 免反击**不折** ——
   * 那三项已经被 `quickBattle` 的真打结果覆盖，再折是双重计价（决策 48）。
   *
   * **浮点**：取整会把 T1 的 `aiValue` 极差从 30.7% 顶到 50%，V6 直接红（决策 63）。
   */
  aiValue: number;
  body: string;
  accent: string;
  /**
   * 近战表演风格（`races.md §6.4.2` 规则 4）：**数据驱动，不要用 id 字面量判断**。
   * 缺省 `'slash'`。取值由 art-director 按「攻击肢剪影的第一读法」逐兵种复核
   * （直线纵深 → thrust；横向/斜向弧 → slash；垂直下压 → smash），**不按名字里的动词取**。
   */
  anim?: 'thrust' | 'slash' | 'smash';
  /**
   * 「打它不招反击」—— HOMM3 吸血伯爵 `No enemy retaliation` 的同款，**只能加在攻方身上**。
   *
   * 语义严格：**这一支主动攻击时，守方不能回手**。守方身份不受影响（它被攻击时照常反击）。
   * 和"免疫反击"（守方不打回去）是两件不同的事，别混。缺省 `false`。
   *
   * 目前只有赤焰 T3 `p2_threewolf`（三头狼）带这条：扑过去咬一口又弹开，对手够不着。
   * 新增单位带这条之前先想清楚——这是"免掉一次交换成本"，对平衡的撬动和 +2 攻同一量级。
   */
  noRetaliate?: boolean;
  /**
   * **升级形态指向基础版 id**（S4 · spec §2.5）。只有 `p*_xxx_u` 这一层带它，
   * 基础版与中立怪都没有 ⇒ 「是不是升级版」读这个字段，**不要读 id 后缀**
   * （后缀是命名约定，字段是数据；两者同源由 `data/units.ts` 的生成器保证）。
   *
   * 数值**不排表**（决策 66）：攻防 +1 / 伤害上限 +1 / HP ×1.25 向上取整 / 速度不动 /
   * 招募价 ×1.2 逐项取整，全部由 `makeUpgrade()` 从基础版算出来。
   */
  upgradeOf?: string;
  /**
   * **飞行**（spec §16.9① 决策 25 = B「越墙」）。
   *
   * 语义只有三条，全部在 `battle.ts` 里落地：
   *   ① 寻路走第二条 BFS —— 人 / 城防 / 护城河**全能穿过**；
   *   ② **落点**仍禁「有人 / 有城防」（飞行不是瞬移）；
   *   ③ 站进护城河不吃 `moatStuck`、也不吃 −2 防（它不踩泥）。
   *
   * 六个兵：鹰 / 天使 / 恶魔 / 绿龙 / 吸血鬼 / 摄魂怪。
   * ⚠️ **与体形档无关**：鹰与吸血鬼是 `canFly` 却走"高"档（收翼），
   *    体形档只看剪影，见 §15.2 的警告。两套东西不许互相推导。
   */
  canFly?: boolean;
  /**
   * **高级兵自带魔法**（spec §10.3，只给没有招牌能力的 T4/T5，共 6 条）。
   *
   * 全部**自动触发、不耗蓝、不占按钮、不占行动**；表在 `data/innates.ts`。
   * 升级形态经 `makeUpgrade()` 的 `...base` 自动继承 —— 圣骑士一样有「誓约」。
   */
  innate?: { id: InnateId };
  /**
   * **吸血比例**（0~1，招牌能力，不是 `innate`）：自己主动近战造成伤害后，
   * 按 `伤害 × 比例 ÷ 自身 HP` 回补人数，上限不超过建队时的人数。
   * 吸血鬼 0.5 / 摄魂怪 0.3（§16.3）。**只有自己出手才吸，反击不吸**。
   */
  drain?: number;
  /**
   * **被动自复活比例**（招牌能力）：本队被歼灭时自动重返战场，**每场一次**。
   * 数量 = `max(1, ceil(倒下前人数 × 比例))` —— 取整不能省：T5 周产 2，
   * `floor(0.2 × 1) = 0` 会让这个招牌能力在最常见的状态下什么都不发生。
   */
  selfRevive?: number;
  /**
   * **威压**（招牌能力）：近战命中让目标速度 −2，到它下次行动。
   * 不新建士气系统（§16.3 第 4 条），直接复用缠根的时效实现。
   */
  dread?: boolean;
}

/**
 * 六条自带魔法的 id（spec §10.3 定稿，**只许调数值，不许换兵**）。
 *
 * 放在 `types.ts` 而不是 `data/innates.ts`：类型层不 import 数据层
 * （`types.ts` 是整个 core 的最底层，反向依赖会成环）。
 */
export type InnateId =
  | 'oath' // p1 T4 骑士 · 誓约（光环）
  | 'lavaArmor' // p2 T4 熔岩巨人 · 熔岩护甲（被动）
  | 'flameBody' // p2 T5 恶魔 · 烈焰缠身（触发）
  | 'stoneSuppress' // p3 T4 猿人 · 投石压制（触发）
  | 'dragonFear' // p3 T5 绿龙 · 龙威（光环）
  | 'stun'; // p4 T4 牛头怪 · 震慑（触发）

export interface Stack {
  unitTypeId: string;
  count: number;
}

export type Army = Stack[];

/* ---------------- hero ---------------- */

export interface HeroPrimary {
  attack: number;
  defense: number;
  spellPower: number;
  knowledge: number;
}

export type ArtifactSlot = 'weapon' | 'shield' | 'helm' | 'armor' | 'ring' | 'boots' | 'misc';

export interface ArtifactDef {
  id: string;
  name: string;
  slot: ArtifactSlot;
  desc: string;
  mods?: Partial<HeroPrimary>;
  moveBonus?: number;
  dailyGold?: number;
}

export interface Hero {
  id: string;
  name: string;
  heroClass: string;
  portrait: string;
  level: number;
  exp: number;
  primary: HeroPrimary;
  mana: number;
  manaMax: number;
  movePoints: number;
  army: Army;
  artifacts: string[];
  /**
   * 穿戴表（§9.1 数据口径，2026-10-31）。**旧档没有这个字段** ⇒ 读时按
   * 「每个槽取 `artifacts` 里第一个匹配」兜底（`game/exchange.ts equippedOf`），
   * 与现有面板显示逐字一致，因此**不需要迁移器**。
   *
   * 物品**仍留在 `artifacts` 里**（不搬数组，避免下标/顺序失效）；这里只记"哪个 id 在哪个槽"。
   */
  equipped?: Partial<Record<ArtifactSlot, string>>;
  /** 已学会的法术 id（M4）。 */
  spells: string[];
  /** 携带的攻城器械（M6）：在带「工坊」的己方城镇花钱装配。 */
  warMachines?: WarMachineId[];
  pos: GridPos;
  owner: PlayerId;
}

/* ---------------- map ---------------- */

export type TerrainKind = 'grass' | 'dirt' | 'sand' | 'snow' | 'swamp' | 'water' | 'rock';

export interface TerrainDef {
  id: TerrainKind;
  name: string;
  top: string;
  left: string;
  right: string;
  moveCost: number;
  passable: boolean;
}

export type MapObjectKind =
  | 'resourcePile'
  | 'treasureChest'
  | 'artifact'
  | 'fountain'
  | 'wanderingMonster'
  | 'town'
  | 'mine'
  | 'vault'
  | 'obstacle';

export interface ResourcePilePayload {
  resource: ResourceKind;
  amount: number;
}
export interface ChestPayload {
  gold: number;
  artifactId?: string;
}
export interface FountainPayload {
  moveRestore: number;
}
/** 野怪看守的东西：打赢才能拿走，打不赢就拿不到也过不去。 */
export type GuardReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'resource'; resource: ResourceKind; amount: number }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'mine'; resource: ResourceKind; perDay: number };

export interface MonsterPayload {
  army: Army;
  tier: 'weak' | 'mid' | 'strong';
  /** 守财：击败后发放 */
  guard?: GuardReward;
  /**
   * §19.3 爆发怪（EV2）。`true` ⇒ 本周爆发生成、打死才消失、**不给赏金**（`guard` 必为 undefined）。
   *
   * 这个标记是落点/计数/角标的**唯一真相**：`outbreakStacks(state)` 数它，
   * `MapRenderer` 据此画 6×6 红角标，地图生成器产出的野怪永远不带它。
   */
  outbreak?: boolean;
  /** 第几周爆发的（只用于日志/调试，不参与判定）。 */
  outbreakWeek?: number;
}
export interface ArtifactPayload {
  artifactId: string;
}
export interface TownPayload {
  townId: string;
}
export interface ObstaclePayload {
  variant: 'tree' | 'rock' | 'mountain';
}
/** 已占领的矿场，每日产出资源。M7 起七种资源都能产出。 */
export interface MinePayload {
  resource: ResourceKind;
  perDay: number;
  owner: PlayerId;
}
/**
 * 宝库区：一群重兵守着的金库，打赢才拿得到，拿完就没了（once）。
 * 和野怪的区别是——它不守路，它是个"值得专门跑一趟"的目标。
 */
export interface VaultPayload {
  army: Army;
  tier: 'mid' | 'strong';
  reward: { gold: number; resources: ResourceBag; artifactId?: string };
}
export type ObjectPayload =
  | ResourcePilePayload
  | ChestPayload
  | FountainPayload
  | MonsterPayload
  | TownPayload
  | ObstaclePayload
  | ArtifactPayload
  | MinePayload
  | VaultPayload
  | null;

export interface MapObject {
  id: string;
  kind: MapObjectKind;
  /**
   * 物件"站上去"的那一格，也就是可交互格。
   *
   * 多格物件（目前只有 2×2 城堡）里，它是唯一的入口格 —— **城门**。
   * 其余 footprint 格子一律不可通行，所以进城的路径天然只剩正面那一条。
   */
  pos: GridPos;
  /**
   * 多格物件占据的全部格子（含 pos 这一格）；单格物件不设置。
   *
   * 不变量：`pos` 必在 `footprint` 内，且是其中唯一可通行的格子。
   */
  footprint?: GridPos[];
  payload: ObjectPayload;
  once: boolean;
  blocking: boolean;
  visitedBy: PlayerId[];
}

export interface Tile {
  terrain: TerrainKind;
  objectId: string | null;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[];
  objects: Record<string, MapObject>;
}

/* ---------------- town ---------------- */

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  cost: ResourceBag;
  requires: string[];
  /**
   * 最高等级（S4 · spec §2.4）。缺省 **1** = 只有一级、没有升级入口。
   *
   * 只有**兵营五座**现在是 3（L2 就是兵种升级入口，§2.5）。市场 / 魔法链的三级外形
   * 是 02c / S5 的美术活，**没有落地前不许把 maxLevel 写成 3** —— 否则玩家花 800 金
   * 买到一个什么都不变的等级，那比"没有升级"更糟。
   */
  maxLevel?: number;
  /** 每日金币税收 */
  dailyGold?: number;
  /** 驻军防御加成（取已建城墙中的最大值） */
  defenseBonus?: number;
  /**
   * 该兵营解锁的兵种与周增长。**按 `tier` 表达，不写死 `unitTypeId`**（段 2）。
   *
   * 为什么是 `tier` 而不是 `unitTypeId`：`dwell3` 在晨曦/赤焰/翠林/紫晶里该长出
   * **四种不同的兵**；写死一个 id 就等于让四族共用同一张兵种表 —— 这正是
   * 「四族兵种都一样」抱怨的根因。`tier` 是唯一与阵营无关的坐标，具体 id 由
   * `unitIdForTier(owner, tier)` 在**运行时**按城镇 owner 解析
   * （`races.md §6.4.2` 规则 3）。
   *
   * ⚠️ 因此 `growth` 只在**有 owner 的语境**下有意义：`unitIdForTier` 对中立方
   * 返回 `null`（规则 5），调用方必须跳过并记日志，**不得 fallback 到 p1**。
   */
  growth?: {
    tier: number;
    /**
     * ⚠️ 这里**故意没有** `count`（2026-10-20 删除）。
     *
     * 周产数量的唯一权威是 `UnitType.growthPerWeek`（`core/data/units.ts`）：
     * 四族 T1 分别是 11/12/10/9，写死一个数就必然与兵种表冲突。
     * 旧字段 `count` 曾是与 `growthPerWeek` 并存的**第二份真相**，而
     * `applyWeeklyGrowth` 只读 `count` ⇒ 兵种表的周产是死数据，
     * 四族增长完全相同（`production/faction-gameplay-review-2026-10-20.md §1.2`）。
     * 现在 `tier` 只负责"这是第几级兵的槽位"，数值一律查兵种。
     */
  };
  /** 全局周增长比例加成（**加算**：城防线 wall2 + wall3 = +50%，§27.3） */
  growthBonus?: number;
  /**
   * 只给**指定档位**的周产乘一个系数（`banner`「主力营」= 本族 T3 ×1.5）。
   *
   * 与 `growthBonus` 的两点区别，缺一条就会读错数：
   *   ① **只作用一档**（`growthBonus` 作用全档）；
   *   ② **乘算**（`growthBonus` 与难度加成加算，§27.10）。
   *
   * ⇒ 满建时 T3 实际是 `(1 + 0.25 + 0.25) × 1.5 = 2.25×`，不是 `1 + 0.5 + 0.5`。
   * 写成 `{ tier, mult }` 而不是复用 `growth`：`growth` 是"这一档的兵营"，
   * 一座城对同一 tier 只能有一个；`banner` 是**加成**，将来多座也要能叠（故用乘）。
   */
  tierGrowthBoost?: { tier: number; mult: number };
  /** 解锁的城镇功能 */
  feature?: 'tavern' | 'market' | 'guild' | 'workshop';
}

export interface Town {
  id: string;
  name: string;
  /** 城门格：英雄站上这里才能进城。 */
  pos: GridPos;
  /** 2×2 城堡占的全部格子（含城门）；与地图上的 town 物件保持一致。 */
  footprint?: GridPos[];
  owner: PlayerId;
  buildings: string[];
  /**
   * 建筑等级（S4 · spec §2.4）：`{ dwell3: 2 }`。**缺省 / 缺失 = 1**。
   *
   * 为什么单独一张表而不是在 `buildings` 里写重复 id：`buildings` 是"有哪些建筑"的
   * 集合（`hasBuilding` = includes），升级是"同一栋长大"，不是新建一栋。写重复 id
   * 会让所有 `for (const id of town.buildings)` 的遍历各读一次同一栋楼
   * （日收入、城防、周产都在这条循环里）。
   *
   * 可选字段 —— 旧存档读出来是 undefined，按 1 处理，不需要迁移器。
   */
  levels?: Record<string, number>;
  garrison: Army;
  growthPool: Record<string, number>;
  /** 每周增长的的小数余数累加器：growthBonus 让 growthPerWeek×mult 出现小数，
   *  整数部分进 growthPool，余下小数攒在这里，攒满 1 再进位。
   *  可选字段——旧存档读出来是 undefined，按 0 处理，不会崩。 */
  growthRemainder?: Record<string, number>;
  /** 已招募过英雄的周次，用于酒馆每周限一次 */
  hiredWeek?: number;
  /** 最近一次建成建筑的日子；每座城每天只能建一座 */
  builtDay?: number;
}

/* ---------------- state ---------------- */

export interface PlayerState {
  /** 显示名：玩家自己填的名字，或电脑领主的名字。 */
  name: string;
  faction: FactionId;
  /** false = 电脑对手（由 ai.ts 驱动） */
  isHuman: boolean;
  resources: ResourceBag;
  revealed: number[];
  /**
   * 连续多少天没有城镇，每天在 endDay 里推进一次。
   *
   * 这是**历史**，推不出来（只看当前状态无法知道"已经没城几天了"），所以必须落盘。
   * 电脑对手连满 NO_TOWN_GRACE_DAYS 天判出局：既给它留一个翻盘窗口，
   * 又不会让图上永远留着一个"有英雄但什么也做不了"的僵尸阵营。
   * 可选字段 —— 旧存档读出来是 undefined，按 0 天算，谁也不会被追溯出局。
   */
  noTownDays?: number;
}

/** 一局的终局状态。playing 之外的状态会锁定操作并弹结算界面。 */
export type GameStatus = 'playing' | 'won' | 'lost';

/**
 * 存档 schema 版本。**唯一来源**：生成器写它、`persistence.ts` 用它判"能不能读 / 要不要迁"。
 *
 * v8（2026-10-31，B1）：兵种阵容 v3 —— 20 个 canonical id 全换，v7 档必须过
 * `normalizeLegacyUnitIds()` 才能读。⚠️ 迁移**只能跑一次**：新旧阵容里 `p3_treant`
 * 是同一个字符串、指两个兵（旧 T4 树人 / 新 T3 树人）⇒ 对 v8 档再跑一遍会把树人变猿人。
 */
export const SAVE_VERSION = 8;

export interface GameState {
  version: number;
  seed: number;
  config: GameConfig;
  map: GameMap;
  heroes: Record<string, Hero>;
  towns: Record<string, Town>;
  players: Record<string, PlayerState>;
  day: number;
  heroOrder: string[];
  log: LogEntry[];
  nextObjectId: number;
  status: GameStatus;
  /**
   * 本周生长事件（spec §19.2 / EV1）。`endDay` 在周界重掷并写入。
   *
   * **为什么要进存档**：事件已经作用于 `growthPool`，若只留在 UI 内存里，
   * 读档后玩家看到"池子比上周多 5 个"却没有任何解释 —— 那会被当成 bug。
   */
  weekEvent?: WeekEvent;
  /**
   * 地图爆发状态（spec §19.3 / EV2）。`endDay` 在周首写预告、在爆发日落地。
   *
   * **为什么进 `GameState`（而不是 UI 内存）**：`lastDay` 是补结算的唯一闸门
   * （离线三天回来必须补上、且只补一次），`spawned` 是"W6 起不再刷"的累计凭证；
   * 两者都没法从地图反推 ⇒ 不存就丢。
   */
  outbreak?: OutbreakState;
}

/**
 * 一周的生长事件：`calm`（67%）/ `growth`（25%，某兵 +5/+3/+2）/ `plague`（8%，×0.5）。
 *
 * `unitTypeId` 是**基础版 id**：升级后的巢穴由 `eventAddOf` 归一到基础版再比对，
 * 于是"升过级的兵也能吃到生物周"（§19.2「作用形态」）。
 */
export interface WeekEvent {
  kind: 'calm' | 'growth' | 'plague';
  week: number;
  unitTypeId?: string;
  tier?: number;
  add?: number;
  mult: number;
  text: string;
}

/**
 * 本周的地图爆发预告（spec §19.3 / EV2）。周首掷出、写在日志里、到 `day` 才落地。
 *
 * `armies` 在**周首**就生成好：预告文案说"狼群过境"，到那天再抽兵种就会出现
 * "说好的狼来了猪" —— 所以兵种与文案必须同一批产物。
 */
export interface OutbreakNotice {
  week: number;
  /** 预告的绝对天数（`(week-1)*7 + 3` = 本周三）。 */
  day: number;
  /** 预告栈数（已按上限夹过）；到那天按**当时**余量落地，不足不补发。 */
  count: number;
  armies: Army[];
  /** 群名用的兵种（= `armies[0][0]`），只影响文案。 */
  unitTypeId: string;
  name: string;
  text: string;
}

/**
 * 地图爆发的持久状态（spec §19.3.4）。**必须进存档**：
 *   · `lastDay` —— 补结算的唯一闸（`lastDay >= notice.day` ⇒ 已落过，不重复）；
 *   · `spawned` —— 累计落地栈数（被清掉的也算；W6 起必须停住）；
 *   · `live` —— 当前在图栈数快照（每次 `endDay` 与 `outbreakStacks()` 刷新）。
 *     判定**永远只数地图**（`outbreakStacks`），`live` 只给存档/UI 看，不参与决策。
 */
export interface OutbreakState {
  lastDay: number;
  spawned: number;
  live: number;
  notice?: OutbreakNotice;
}

export interface LogEntry {
  day: number;
  text: string;
}
