import type { Day, Stop, Trip } from './trip.ts';

export type Budget = 'low' | 'mid' | 'high';
export type PlanPrefs = { transport: 'car' | 'train'; budget: Budget; late: boolean; seated: boolean };

export const DEFAULT_PREFS: PlanPrefs = { transport: 'car', budget: 'mid', late: false, seated: false };

export const PLAN_DATE = '2026-11-15';
export const PLAN_TITLE = '箱根 → 河口湖';

const MEAL_SCALE: Record<Budget, number> = { low: 0.6, mid: 1, high: 2 };
export const BUDGET_LABEL: Record<Budget, string> = { low: '省錢', mid: '適中', high: '不限' };

function meal(base: number, budget: Budget): number {
  return Math.round((base * MEAL_SCALE[budget]) / 1000) * 1000;
}

/**
 * Fills the Hakone to Kawaguchiko day. Only 2026-11-15 has a template, so other dates return null.
 * Existing `stay` stops are kept and every other stop on that day is replaced.
 */
export function planDay(trip: Trip, date: string, input: Partial<PlanPrefs> = {}): Trip | null {
  if (date !== PLAN_DATE) return null;
  const day = trip.days.find((entry) => entry.date === date);
  if (!day) return null;
  const prefs = { ...DEFAULT_PREFS, ...input };
  const train = prefs.transport === 'train';
  const stays = day.stops.filter((stop) => stop.kind === 'stay').map((stop) => (train ? { ...stop, transport: 'bus' as const } : stop));
  const stops = [...(prefs.late ? [] : [early(train)]), ...(train ? byTrain(prefs) : byCar(prefs)), dinner(prefs), ...stays].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const planned: Day = { ...day, title: PLAN_TITLE, stops };
  return { ...trip, days: trip.days.map((entry) => (entry.date === date ? planned : entry)) };
}

function early(train: boolean): Stop {
  return {
    id: 'd3-early',
    time: '08:30',
    place: '箱根町港 蘆之湖晨景',
    kind: 'sight',
    lat: 35.1912,
    lng: 139.024,
    notes: '早上湖面平靜，天氣好時可以看到富士山倒影，人也少。',
    transport: train ? 'bus' : 'car',
    cost: 0,
  };
}

function shrine(train: boolean): Stop {
  return {
    id: 'd3-shrine',
    time: '10:00',
    place: '箱根神社 平和鳥居',
    kind: 'sight',
    lat: 35.2043,
    lng: 139.0253,
    notes: '湖中的紅色鳥居是拍照重點，參拜完再往河口湖移動。',
    transport: train ? 'bus' : 'car',
    cost: 0,
  };
}

function byCar({ budget }: PlanPrefs): Stop[] {
  return [
    shrine(false),
    {
      id: 'd3-susuki',
      time: '11:30',
      place: '仙石原 芒草原',
      kind: 'sight',
      lat: 35.2569,
      lng: 139.0292,
      notes: '11 月芒草還在，路邊停車即可，順路不繞遠。',
      transport: 'car',
      cost: 0,
    },
    {
      id: 'd3-lunch',
      time: '13:00',
      place: '御殿場 道の駅 すばしり',
      kind: 'meal',
      lat: 35.3547,
      lng: 138.9164,
      notes: `午餐在道の駅解決，停車方便（預算${BUDGET_LABEL[budget]}）。`,
      transport: 'car',
      cost: meal(6000, budget),
    },
    {
      id: 'd3-hana',
      time: '14:30',
      place: '山中湖 花の都公園',
      kind: 'sight',
      lat: 35.4143,
      lng: 138.87,
      notes: '富士山就在眼前，草地可以讓小朋友跑一跑，約一小時。',
      transport: 'car',
      cost: 0,
    },
  ];
}

function byTrain({ budget }: PlanPrefs): Stop[] {
  return [
    shrine(true),
    {
      id: 'd3-pirate',
      time: '11:30',
      place: '箱根海賊船（元箱根港 → 桃源台港）',
      kind: 'sight',
      lat: 35.1873,
      lng: 139.0233,
      notes: '單程約 30 分鐘，每人約 ¥1,200，船上看得到富士山。',
      transport: 'walk',
      cost: 6000,
    },
    {
      id: 'd3-lunch',
      time: '12:45',
      place: '桃源台港 周邊餐廳',
      kind: 'meal',
      lat: 35.2482,
      lng: 139.0215,
      notes: `下船後步行可到的簡餐店，趕 13:50 的巴士（預算${BUDGET_LABEL[budget]}）。`,
      transport: 'walk',
      cost: meal(5000, budget),
    },
    {
      id: 'd3-bus',
      time: '13:50',
      place: '桃源台 → 河口湖站 直達高速巴士',
      kind: 'transfer',
      lat: 35.4986,
      lng: 138.7683,
      notes: '約 2 小時，每人約 ¥2,000，建議先在窗口劃位。',
      transport: 'bus',
      cost: 10000,
    },
  ];
}

function dinner({ budget, seated }: PlanPrefs): Stop {
  const base = {
    id: 'd3-dinner',
    time: '18:30',
    kind: 'meal' as const,
    lat: 35.5004,
    lng: 138.765,
    transport: 'walk' as const,
  };
  if (seated) {
    return {
      ...base,
      place: 'ほうとう 歩成 河口湖本店（有座位）',
      notes: `餺飥鍋配椅子座位，已預約 18:30 五位（預算${BUDGET_LABEL[budget]}）。`,
      cost: meal(15000, budget),
    };
  }
  return {
    ...base,
    place: '小作 河口湖店 餺飥',
    notes: `旅館附近的餺飥連鎖店，現場候位即可（預算${BUDGET_LABEL[budget]}）。`,
    cost: meal(12000, budget),
  };
}
