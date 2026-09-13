type Handler = (payload?: unknown) => void;

const buses = new Map<string, Handler[]>();

export const EV = {
  STATE_CHANGED: 'state:changed',
  LOG: 'log',
} as const;

export function on(type: string, h: Handler): void {
  const list = buses.get(type) ?? [];
  list.push(h);
  buses.set(type, list);
}

export function emit(type: string, payload?: unknown): void {
  const list = buses.get(type);
  if (!list) return;
  for (const h of list) h(payload);
}
