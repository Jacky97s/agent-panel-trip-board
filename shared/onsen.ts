import { type Stop, type Trip, findStop, updateStop } from './trip.ts';

export type Onsen = { place: string; lat: number; lng: number; perPerson: number; notes: string };

export const ONSEN_TABLE: readonly Onsen[] = [
  { place: '新宿 Thermae-yu 歌舞伎町', lat: 35.6955, lng: 139.7015, perPerson: 2500, notes: '都心天然溫泉，24 小時營業，毛巾租借另計。' },
  { place: '東京 Spa LaQua 後樂園', lat: 35.7056, lng: 139.7516, perPerson: 3300, notes: '水道橋站旁，地下 700 公尺湧出的天然溫泉，有家族可用的休息區。' },
  { place: '箱根湯本 天成園', lat: 35.2338, lng: 139.105, perPerson: 1800, notes: '日歸入浴，有空中露天風呂，建議先電話確認開放時段。' },
  { place: '箱根 天山湯治郷', lat: 35.2368, lng: 139.0937, perPerson: 1500, notes: '森林中的露天風呂，各池為男女分浴，停車場免費。' },
  { place: '強羅 箱根小涌園 Yunessun', lat: 35.2455, lng: 139.0555, perPerson: 2500, notes: '泳裝入場的溫泉主題樂園，帶小孩玩得開心。' },
  { place: '富士吉田 ふじやま溫泉', lat: 35.48, lng: 138.804, perPerson: 1500, notes: '可遠眺富士山的日歸溫泉，有 5 人可坐的休息室。' },
  { place: '河口湖 ホテル鐘山苑 日歸溫泉', lat: 35.5075, lng: 138.773, perPerson: 2200, notes: '湖畔旅館的日歸入浴，露天風呂望得到河口湖。' },
];

function distance(a: Onsen, stop: Stop): number {
  if (stop.lat === undefined || stop.lng === undefined) return 0;
  return Math.hypot(a.lat - stop.lat, (a.lng - stop.lng) * Math.cos((stop.lat * Math.PI) / 180));
}

export function nearestOnsen(stop: Stop): Onsen {
  return ONSEN_TABLE.reduce((best, entry) => (distance(entry, stop) < distance(best, stop) ? entry : best));
}

/** Replaces only the selected stop, keeping its id and time. Returns null when the stop does not exist. */
export function replaceWithOnsen(trip: Trip, stopId: string): Trip | null {
  const found = findStop(trip, stopId);
  if (!found) return null;
  const onsen = nearestOnsen(found.stop);
  return updateStop(trip, stopId, {
    place: onsen.place,
    kind: 'onsen',
    lat: onsen.lat,
    lng: onsen.lng,
    notes: onsen.notes,
    cost: onsen.perPerson * trip.travelers,
  });
}
