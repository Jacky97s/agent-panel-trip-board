import { describe, expect, it } from 'vitest';
import { detectIntent } from '../shared/intent.ts';

const wrap = (text: string, { day = 'none', stop = 'none' } = {}) =>
  `<agent-panel-capability>\ntrip path: /x/t.json\nselected day: ${day}\nselected stop id: ${stop}\n</agent-panel-capability>\n\n${text}`;

describe('detectIntent', () => {
  it.each([
    ['這裡換成溫泉', { stop: 'd2-gora' }, { type: 'replace-selected', stopId: 'd2-gora' }],
    ['幫我排 11/15', {}, { type: 'plan-day', date: '2026-11-15', prefs: {}, ask: true }],
    ['11月15日 規劃行程', {}, { type: 'plan-day', date: '2026-11-15', prefs: {}, ask: true }],
    ['幫我排', { day: '2026-11-15' }, { type: 'plan-day', date: '2026-11-15', prefs: {}, ask: true }],
    ['幫我排 11/15，自駕', {}, { type: 'plan-day', date: '2026-11-15', prefs: { transport: 'car' }, ask: false }],
    ['11/15 從箱根到河口湖，搭電車，省錢', {}, { type: 'plan-day', date: '2026-11-15', prefs: { transport: 'train', budget: 'low' }, ask: false }],
    ['排 11/15，不要太早，晚餐想坐著吃', {}, { type: 'plan-day', date: '2026-11-15', prefs: { late: true, seated: true }, ask: false }],
    ['排行程', {}, { type: 'plan-day', date: null, prefs: {}, ask: true }],
    ['這裡換成溫泉', {}, { type: 'unknown' }],
    ['你好', { day: '2026-11-15', stop: 'd3-ryokan' }, { type: 'unknown' }],
  ])('%s', (text, ctx, expected) => {
    expect(detectIntent(wrap(text, ctx), 2026)).toEqual(expected);
  });

  it('ignores words that only appear in the context block', () => {
    expect(detectIntent(wrap('你好', { day: '2026-11-15' }), 2026)).toEqual({ type: 'unknown' });
  });

  it('lets a date in the text win over the selected day', () => {
    expect(detectIntent(wrap('排 11/14', { day: '2026-11-15' }), 2026)).toMatchObject({ date: '2026-11-14' });
  });
});
