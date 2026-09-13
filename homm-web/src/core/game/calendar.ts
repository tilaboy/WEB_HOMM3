export const DAYS_PER_WEEK = 7;

export function weekOf(day: number): number {
  return Math.floor((day - 1) / DAYS_PER_WEEK) + 1;
}

export function dayOfWeek(day: number): number {
  return ((day - 1) % DAYS_PER_WEEK) + 1;
}

/** 是否为一周的第一天（新的一周开始，触发周增长）。第一天不算。 */
export function isNewWeek(day: number): boolean {
  return day > 1 && dayOfWeek(day) === 1;
}
