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
  /** 玩家（p1）起始资源倍率。基准 {2500, 10, 10} */
  playerStartMul: number;
  /** 玩家每周增长的额外系数，可为负（但不建议给负，会让旧存档中途变难）。
   *  与 growthBonus 走同一条代码路径：累积小数余数，所以 +0.25 也能真正多产兵 */
  playerGrowthBonus: number;
  /** 玩家英雄每日移动力倍率（BASE_MOVE_POINTS = 1800） */
  playerMoveMul: number;
  /** 全部非玩家所属部队（野怪 / 中立城驻军 / 宝库守卫）的规模倍率。
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
  body: string;
  accent: string;
}

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
  /** 每日金币税收 */
  dailyGold?: number;
  /** 驻军防御加成（取已建城墙中的最大值） */
  defenseBonus?: number;
  /** 该兵营解锁的兵种与周增长 */
  growth?: { unitTypeId: string; count: number };
  /** 全局周增长比例加成 */
  growthBonus?: number;
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
  garrison: Army;
  growthPool: Record<string, number>;
  /** 每周增长的的小数余数累加器：growthBonus 让 g.count×mult 出现小数，
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
}

export interface LogEntry {
  day: number;
  text: string;
}
