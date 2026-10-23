import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayCost, findStop, moveStop, parseTrip, tripCost, updateStop } from '../shared/trip.ts';

const seed = () => JSON.parse(readFileSync('data/trips/japan-family-2026.json', 'utf8')) as unknown;
const trip = parseTrip(seed());

describe('parseTrip', () => {
  it('accepts the seed trip', () => {
    expect(trip.days).toHaveLength(5);
    expect(tripCost(trip)).toBe(trip.days.reduce((sum, day) => sum + dayCost(day), 0));
  });

  it.each([
    ['bad currency', (t: any) => (t.currency = 'USD')],
    ['bad time', (t: any) => (t.days[0].stops[0].time = '9:40')],
    ['bad kind', (t: any) => (t.days[0].stops[0].kind = 'museum')],
    ['negative cost', (t: any) => (t.days[0].stops[0].cost = -1)],
    ['lat without lng', (t: any) => delete t.days[0].stops[0].lng],
    ['duplicate id', (t: any) => (t.days[1].stops[0].id = t.days[0].stops[0].id)],
    ['bad id', (t: any) => (t.id = '../x')],
  ])('rejects %s', (_name, mutate) => {
    const bad = seed() as any;
    mutate(bad);
    expect(() => parseTrip(bad)).toThrow();
  });
});

describe('moveStop and updateStop', () => {
  it('moves a stop to another day at an index and leaves the input untouched', () => {
    const moved = moveStop(trip, 'd1-gyoen', '2026-11-15', 0);
    expect(moved.days[2]?.stops.map((stop) => stop.id)).toEqual(['d1-gyoen', 'd3-ryokan']);
    expect(findStop(moved, 'd1-gyoen')?.day.date).toBe('2026-11-15');
    expect(trip.days[0]?.stops.some((stop) => stop.id === 'd1-gyoen')).toBe(true);
  });

  it('ignores unknown stops and dates', () => {
    expect(moveStop(trip, 'nope', '2026-11-15', 0)).toBe(trip);
    expect(moveStop(trip, 'd1-gyoen', '2030-01-01', 0)).toBe(trip);
  });

  it('patches exactly one stop', () => {
    const next = updateStop(trip, 'd1-lunch', { cost: 1 });
    expect(findStop(next, 'd1-lunch')?.stop.cost).toBe(1);
    expect(findStop(next, 'd1-gyoen')?.stop).toEqual(findStop(trip, 'd1-gyoen')?.stop);
  });
});
