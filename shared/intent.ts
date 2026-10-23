import type { PlanPrefs } from './plans.ts';
import { DATE } from './trip.ts';

export type Intent =
  | { type: 'replace-selected'; stopId: string }
  | { type: 'plan-day'; date: string | null; prefs: Partial<PlanPrefs>; ask: boolean }
  | { type: 'unknown' };

const ONSEN = /溫泉|温泉|onsen/i;
const PLANNING = /從.+到|排|規劃|行程|plan/i;
const CAR = /自駕|開車/;
const TRAIN = /電車|巴士|火車|搭車/;
const LATE = /不要太早|晚點出門|晚點出發|睡飽/;
const SEATED = /坐著吃|好好吃|餐廳/;
const LOW = /省錢|便宜/;
const HIGH = /不限|高級|豪華/;
const TEXT_DATE = /(?<!\d)(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*日?/;

export function userText(prompt: string): string {
  const marker = '</agent-panel-capability>';
  const index = prompt.lastIndexOf(marker);
  return (index >= 0 ? prompt.slice(index + marker.length) : prompt).trim();
}

function contextValue(prompt: string, label: string): string {
  const value = prompt.match(new RegExp(`${label}:[ \\t]*([^\\n]*)`))?.[1]?.trim() ?? '';
  return value === 'none' || value === '(none)' ? '' : value;
}

export function selectedStopId(prompt: string): string {
  return contextValue(prompt, 'selected stop id');
}

export function detectIntent(prompt: string, year: number): Intent {
  const text = userText(prompt);
  const stopId = selectedStopId(prompt);
  if (stopId && ONSEN.test(text)) return { type: 'replace-selected', stopId };

  if (!PLANNING.test(text)) return { type: 'unknown' };
  const fromText = text.match(TEXT_DATE);
  const selectedDay = contextValue(prompt, 'selected day');
  const date = fromText
    ? isoDate(year, Number(fromText[1]), Number(fromText[2]))
    : DATE.test(selectedDay)
      ? selectedDay
      : null;

  const prefs: Partial<PlanPrefs> = {};
  if (CAR.test(text)) prefs.transport = 'car';
  else if (TRAIN.test(text)) prefs.transport = 'train';
  if (LOW.test(text)) prefs.budget = 'low';
  else if (HIGH.test(text)) prefs.budget = 'high';
  if (LATE.test(text)) prefs.late = true;
  if (SEATED.test(text)) prefs.seated = true;
  return { type: 'plan-day', date, prefs, ask: !prefs.transport && !prefs.late && !prefs.seated };
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
