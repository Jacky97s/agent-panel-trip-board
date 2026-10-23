export const TRANSPORTS = ['car', 'train', 'bus', 'walk', 'ferry', 'ropeway', 'flight'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const STOP_KINDS = ['sight', 'meal', 'onsen', 'stay', 'shop', 'transfer'] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export const TRANSPORT_LABEL: Record<Transport, string> = {
  car: '自駕',
  train: '電車',
  bus: '巴士',
  walk: '步行',
  ferry: '遊船',
  ropeway: '纜車',
  flight: '飛機',
};

export const KIND_LABEL: Record<StopKind, string> = {
  sight: '景點',
  meal: '用餐',
  onsen: '溫泉',
  stay: '住宿',
  shop: '購物',
  transfer: '交通',
};

/** One stop on a day. `transport` is how the group gets here from the previous stop. */
export type Stop = {
  id: string;
  time: string;
  place: string;
  kind: StopKind;
  lat?: number;
  lng?: number;
  notes: string;
  transport: Transport;
  /** Total for the whole group, in the trip currency. */
  cost: number;
};

export type Day = {
  date: string;
  title: string;
  stops: Stop[];
};

export type Trip = {
  id: string;
  title: string;
  travelers: number;
  currency: 'JPY';
  days: Day[];
};

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TRIP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseTrip(value: unknown): Trip {
  const trip = record(value, 'trip');
  const id = text(trip.id, 'trip.id');
  if (!TRIP_ID.test(id)) throw new Error(`trip.id must match ${TRIP_ID}`);
  const travelers = number(trip.travelers, 'trip.travelers');
  if (!Number.isInteger(travelers) || travelers < 1) throw new Error('trip.travelers must be a positive integer');
  if (trip.currency !== 'JPY') throw new Error('trip.currency must be JPY');
  if (!Array.isArray(trip.days)) throw new Error('trip.days must be an array');
  const days = trip.days.map((entry, index) => parseDay(entry, `trip.days[${index}]`));
  const seen = new Set<string>();
  for (const stop of days.flatMap((day) => day.stops)) {
    if (seen.has(stop.id)) throw new Error(`duplicate stop id: ${stop.id}`);
    seen.add(stop.id);
  }
  return { id, title: text(trip.title, 'trip.title'), travelers, currency: 'JPY', days };
}

function parseDay(value: unknown, at: string): Day {
  const day = record(value, at);
  const date = text(day.date, `${at}.date`);
  if (!DATE.test(date)) throw new Error(`${at}.date must be YYYY-MM-DD`);
  if (!Array.isArray(day.stops)) throw new Error(`${at}.stops must be an array`);
  return {
    date,
    title: typeof day.title === 'string' ? day.title : '',
    stops: day.stops.map((entry, index) => parseStop(entry, `${at}.stops[${index}]`)),
  };
}

function parseStop(value: unknown, at: string): Stop {
  const stop = record(value, at);
  const time = text(stop.time, `${at}.time`);
  if (!TIME.test(time)) throw new Error(`${at}.time must be HH:mm`);
  const kind = oneOf(stop.kind, STOP_KINDS, `${at}.kind`);
  const transport = oneOf(stop.transport, TRANSPORTS, `${at}.transport`);
  const cost = stop.cost === undefined ? 0 : number(stop.cost, `${at}.cost`);
  if (cost < 0) throw new Error(`${at}.cost must not be negative`);
  const parsed: Stop = {
    id: text(stop.id, `${at}.id`),
    time,
    place: text(stop.place, `${at}.place`),
    kind,
    notes: typeof stop.notes === 'string' ? stop.notes : '',
    transport,
    cost,
  };
  if (stop.lat !== undefined || stop.lng !== undefined) {
    const lat = number(stop.lat, `${at}.lat`);
    const lng = number(stop.lng, `${at}.lng`);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`${at} coordinates are out of range`);
    parsed.lat = lat;
    parsed.lng = lng;
  }
  return parsed;
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${at} must be a non-empty string`);
  return value;
}

function number(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at} must be a number`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], at: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`${at} must be one of ${options.join(', ')}`);
  }
  return value as T;
}

export function dayCost(day: Day): number {
  return day.stops.reduce((sum, stop) => sum + stop.cost, 0);
}

export function tripCost(trip: Trip): number {
  return trip.days.reduce((sum, day) => sum + dayCost(day), 0);
}

export function findStop(trip: Trip, stopId: string): { day: Day; stop: Stop; index: number } | null {
  for (const day of trip.days) {
    const index = day.stops.findIndex((stop) => stop.id === stopId);
    if (index >= 0) return { day, stop: day.stops[index] as Stop, index };
  }
  return null;
}

/** Moves a stop to `index` within `toDate`, the index counted after the stop is removed. */
export function moveStop(trip: Trip, stopId: string, toDate: string, index: number): Trip {
  const found = findStop(trip, stopId);
  if (!found || !trip.days.some((day) => day.date === toDate)) return trip;
  const days = trip.days.map((day) => ({ ...day, stops: day.stops.filter((stop) => stop.id !== stopId) }));
  return {
    ...trip,
    days: days.map((day) => {
      if (day.date !== toDate) return day;
      const stops = [...day.stops];
      stops.splice(Math.max(0, Math.min(index, stops.length)), 0, found.stop);
      return { ...day, stops };
    }),
  };
}

export function updateStop(trip: Trip, stopId: string, patch: Partial<Omit<Stop, 'id'>>): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      stops: day.stops.map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
    })),
  };
}

export function formatYen(value: number): string {
  return `¥${Math.round(value).toLocaleString('en-US')}`;
}
