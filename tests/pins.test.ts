import { describe, expect, it } from 'vitest';
import { groupPins } from '../src/pins.ts';

describe('groupPins', () => {
  it('merges pins closer than the radius and skips stops without coordinates', () => {
    const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 210, y: 8 }, null, { x: 5, y: 400 }];
    expect(groupPins(points, 28)).toEqual([[0], [1, 2], [4]]);
  });

  it('keeps every pin apart when none overlap', () => {
    expect(groupPins([{ x: 0, y: 0 }, { x: 40, y: 0 }], 28)).toEqual([[0], [1]]);
  });
});
