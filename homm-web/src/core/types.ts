export type PlayerId = 'p1' | 'neutral';

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
  | { kind: 'mine'; resource: 'gold' | 'wood' | 'ore'; perDay: number };

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
/** 已占领的矿场，每日产出资源。 */
export interface MinePayload {
  resource: 'gold' | 'wood' | 'ore';
  perDay: number;
  owner: PlayerId;
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
  | null;

export interface MapObject {
  id: string;
  kind: MapObjectKind;
  pos: GridPos;
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
  feature?: 'tavern' | 'market' | 'guild';
}

export interface Town {
  id: string;
  name: string;
  pos: GridPos;
  owner: PlayerId;
  buildings: string[];
  garrison: Army;
  growthPool: Record<string, number>;
  /** 已招募过英雄的周次，用于酒馆每周限一次 */
  hiredWeek?: number;
  /** 最近一次建成建筑的日子；每座城每天只能建一座 */
  builtDay?: number;
}

/* ---------------- state ---------------- */

export interface PlayerState {
  resources: ResourceBag;
  revealed: number[];
}

export interface GameState {
  version: number;
  seed: number;
  map: GameMap;
  heroes: Record<string, Hero>;
  towns: Record<string, Town>;
  players: Record<string, PlayerState>;
  day: number;
  heroOrder: string[];
  log: LogEntry[];
  nextObjectId: number;
}

export interface LogEntry {
  day: number;
  text: string;
}
