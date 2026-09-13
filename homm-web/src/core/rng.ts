/** 可播种随机数：同一种子必得同一序列，方便复现 bug 与存档。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** 用位置/天数等整数派生一个稳定的新种子，避免为每件事维护计数器。 */
export function deriveSeed(base: number, ...nums: number[]): number {
  let h = base >>> 0;
  for (const n of nums) {
    h = (Math.imul(h ^ (n >>> 0), 0x9e3779b1) + 0x85ebca6b) >>> 0;
  }
  return h >>> 0;
}
