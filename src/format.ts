import type { Day, Trip } from '../shared/trip.ts';

const WEEKDAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function weekday(date: string): string {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

export function tripRange(trip: Trip): string {
  const first = trip.days[0];
  const last = trip.days[trip.days.length - 1];
  if (!first || !last) return `${trip.travelers} 位大人`;
  return `${shortDate(first.date)}–${shortDate(last.date)} · ${trip.days.length} 天 · ${trip.travelers} 位大人`;
}

export function dayLabel(day: Day): string {
  return `${shortDate(day.date)} ${day.title}`.trim();
}
