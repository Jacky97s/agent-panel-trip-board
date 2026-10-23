import fs from 'node:fs/promises';
import path from 'node:path';
import { geocodePath } from './paths.ts';

export type LatLng = { lat: number; lng: number };
type Cache = Record<string, LatLng | null>;

const ENDPOINT = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&q=';
const USER_AGENT = 'agent-panel-trip-board/0.1 (+https://github.com/Jacky97s/agent-panel-trip-board)';
const MIN_GAP_MS = 1000;

export type Geocoder = { lookup(query: string): Promise<LatLng | null | undefined> };

/** Resolves a place to coordinates. `undefined` means unresolved right now (disabled, offline, or rate limited). */
export function createGeocoder(root: string, fetchImpl: typeof fetch = fetch): Geocoder {
  const file = geocodePath(root);
  let cache: Promise<Cache> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequest = 0;

  const load = () =>
    (cache ??= fs
      .readFile(file, 'utf8')
      .then((raw) => JSON.parse(raw) as Cache)
      .catch((): Cache => ({})));

  async function fetchOne(query: string): Promise<LatLng | null | undefined> {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    try {
      const response = await fetchImpl(ENDPOINT + encodeURIComponent(query), {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return undefined;
      const hits = (await response.json()) as { lat?: string; lon?: string }[];
      const lat = Number(hits[0]?.lat);
      const lng = Number(hits[0]?.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return undefined;
    }
  }

  return {
    async lookup(query) {
      const entries = await load();
      if (query in entries) return entries[query];
      if (process.env.TRIP_GEOCODE === 'off') return undefined;
      const result = queue.then(async () => {
        if (query in entries) return entries[query];
        const found = await fetchOne(query);
        if (found === undefined) return undefined;
        entries[query] = found;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `${JSON.stringify(entries, null, 2)}\n`);
        return found;
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
