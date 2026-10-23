import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nearestOnsen, replaceWithOnsen } from '../shared/onsen.ts';
import { planDay } from '../shared/plans.ts';
import { findStop, parseTrip } from '../shared/trip.ts';

const trip = parseTrip(JSON.parse(readFileSync('data/trips/japan-family-2026.json', 'utf8')));
const planned = (prefs = {}) => planDay(trip, '2026-11-15', prefs)!.days[2]!;

describe('planDay', () => {
  it('only has a template for 2026-11-15', () => {
    expect(planDay(trip, '2026-11-14')).toBeNull();
    expect(planDay(trip, '2030-01-01')).toBeNull();
  });

  it('keeps the stay stop and fills 4 to 6 new stops with coordinates, in time order', () => {
    for (const prefs of [{}, { late: true }, { transport: 'train' as const }, { late: true, transport: 'train' as const, seated: true }]) {
      const day = planned(prefs);
      expect(day.title).toBe('箱根 → 河口湖');
      expect(day.stops.find((stop) => stop.id === 'd3-ryokan')).toMatchObject({ place: '河口湖 湖山亭產屋 入住', time: '16:30', cost: 120000 });
      expect(day.stops.length - 1).toBeGreaterThanOrEqual(4);
      expect(day.stops.length - 1).toBeLessThanOrEqual(6);
      expect(day.stops.every((stop) => stop.lat !== undefined && stop.lng !== undefined)).toBe(true);
      expect(day.stops.map((stop) => stop.time)).toEqual(day.stops.map((stop) => stop.time).sort());
      expect(new Set(day.stops.map((stop) => stop.id)).size).toBe(day.stops.length);
    }
  });

  it('leaves every other day untouched and still parses', () => {
    const next = planDay(trip, '2026-11-15')!;
    expect(next.days.filter((day) => day.date !== '2026-11-15')).toEqual(trip.days.filter((day) => day.date !== '2026-11-15'));
    expect(() => parseTrip(next)).not.toThrow();
  });

  it('starts at 08:30 with an early sight, or at 10:00 or later when late', () => {
    expect(planned().stops[0]).toMatchObject({ id: 'd3-early', time: '08:30' });
    expect(planned({ late: true }).stops[0]!.time >= '10:00').toBe(true);
    expect(planned({ late: true }).stops.some((stop) => stop.id === 'd3-early')).toBe(false);
  });

  it('books a seated dinner at 18:30 when asked', () => {
    const dinner = planned({ seated: true }).stops.find((stop) => stop.id === 'd3-dinner')!;
    expect(dinner).toMatchObject({ time: '18:30', kind: 'meal' });
    expect(dinner.place).toContain('有座位');
    expect(dinner.notes).toContain('預約');
    expect(planned().stops.find((stop) => stop.id === 'd3-dinner')!.place).not.toContain('有座位');
  });

  it('uses buses and no car for the train variant', () => {
    const day = planned({ transport: 'train' });
    expect(day.stops.some((stop) => stop.transport === 'car')).toBe(false);
    expect(day.stops.some((stop) => stop.id === 'd3-bus')).toBe(true);
    expect(planned({ transport: 'car' }).stops.some((stop) => stop.transport === 'car')).toBe(true);
  });

  it('scales meal costs with the budget', () => {
    const lunch = (budget: 'low' | 'mid' | 'high') => planned({ budget }).stops.find((stop) => stop.id === 'd3-lunch')!.cost;
    expect(lunch('low')).toBeLessThan(lunch('mid'));
    expect(lunch('mid')).toBeLessThan(lunch('high'));
  });
});

describe('replaceWithOnsen', () => {
  it('changes only the selected stop and keeps its id and time', () => {
    const next = replaceWithOnsen(trip, 'd2-owakudani')!;
    const before = findStop(trip, 'd2-owakudani')!.stop;
    const after = findStop(next, 'd2-owakudani')!.stop;
    expect(after).toMatchObject({ id: before.id, time: before.time, kind: 'onsen' });
    expect(after.place).not.toBe(before.place);
    expect(next.days.flatMap((day) => day.stops).filter((stop) => stop.id !== 'd2-owakudani')).toEqual(
      trip.days.flatMap((day) => day.stops).filter((stop) => stop.id !== 'd2-owakudani'),
    );
  });

  it('picks the nearest facility and returns null for an unknown stop', () => {
    expect(nearestOnsen(findStop(trip, 'd2-owakudani')!.stop).place).toContain('箱根');
    expect(nearestOnsen(findStop(trip, 'd4-oishi')!.stop).place).toMatch(/河口湖|富士吉田/);
    expect(nearestOnsen(findStop(trip, 'd1-gyoen')!.stop).place).toMatch(/新宿|東京/);
    expect(replaceWithOnsen(trip, 'nope')).toBeNull();
  });
});
