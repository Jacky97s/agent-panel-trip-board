import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTrip } from '../shared/trip.ts';
import { cleanup, poll, start, TRIP_ID } from './harness.ts';

afterEach(cleanup);

const putTrip = (origin: string, id: string, trip: unknown) =>
  fetch(`${origin}/api/trips/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trip }),
  });

describe('trip api', () => {
  it('lists trips and returns a trip with no unresolved stops', async () => {
    const env = await start();
    try {
      const list = (await (await fetch(`${env.origin}/api/trips`)).json()) as { trips: { id: string }[] };
      expect(list.trips.map((trip) => trip.id)).toEqual([TRIP_ID]);
      const body = (await (await fetch(`${env.origin}/api/trips/${TRIP_ID}`)).json()) as { trip: { days: unknown[] }; unresolved: string[] };
      expect(body.trip.days).toHaveLength(5);
      expect(body.unresolved).toEqual([]);
    } finally {
      await env.close();
    }
  });

  it('returns trip null with an error for a half-written file', async () => {
    const env = await start();
    try {
      await writeFile(env.tripFile, '{"id":');
      const response = await fetch(`${env.origin}/api/trips/${TRIP_ID}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { trip: unknown; error: string };
      expect(body.trip).toBeNull();
      expect(body.error).not.toBe('');
    } finally {
      await env.close();
    }
  });

  it('fills missing coordinates from the geocode cache and lists the rest as unresolved', async () => {
    const env = await start();
    process.env.TRIP_GEOCODE = 'off';
    try {
      const trip = parseTrip(JSON.parse(await readFile(env.tripFile, 'utf8')));
      const [first, second] = trip.days[0]!.stops;
      delete first!.lat;
      delete first!.lng;
      delete second!.lat;
      delete second!.lng;
      await writeFile(env.tripFile, JSON.stringify(trip));
      await mkdir(`${env.root}/cache`, { recursive: true });
      await writeFile(`${env.root}/cache/geocode.json`, JSON.stringify({ [first!.place]: { lat: 1, lng: 2 }, [second!.place]: null }));
      const body = (await (await fetch(`${env.origin}/api/trips/${TRIP_ID}`)).json()) as {
        trip: { days: { stops: { id: string; lat?: number }[] }[] };
        unresolved: string[];
      };
      expect(body.trip.days[0]!.stops[0]!.lat).toBe(1);
      expect(body.unresolved).toEqual([second!.id]);
      expect(JSON.parse(await readFile(env.tripFile, 'utf8')).days[0].stops[0].lat).toBeUndefined();
    } finally {
      delete process.env.TRIP_GEOCODE;
      await env.close();
    }
  });

  it('rejects an invalid trip, a mismatched id, and a path-like id on PUT', async () => {
    const env = await start();
    try {
      const good = parseTrip(JSON.parse(await readFile(env.tripFile, 'utf8')));
      expect((await putTrip(env.origin, TRIP_ID, { ...good, days: 'nope' })).status).toBe(400);
      expect((await putTrip(env.origin, TRIP_ID, { ...good, id: 'other' })).status).toBe(400);
      expect((await putTrip(env.origin, '..%2Fescape', good)).status).toBe(400);
      expect((await putTrip(env.origin, TRIP_ID, { ...good, title: 'renamed' })).status).toBe(200);
      expect(JSON.parse(await readFile(env.tripFile, 'utf8')).title).toBe('renamed');
    } finally {
      await env.close();
    }
  });

  it('emits a trip event over SSE when the file changes', async () => {
    const env = await start();
    const controller = new AbortController();
    try {
      const response = await fetch(`${env.origin}/api/events`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      let received = '';
      const reader = response.body!.getReader();
      void (async () => {
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          received += decoder.decode(value);
        }
      })().catch(() => undefined);
      await poll(() => (received.includes(': connected') ? true : undefined));
      await writeFile(env.tripFile, await readFile(env.tripFile));
      await poll(() => (received.includes('event: trip') ? true : undefined), () => received);
      expect(received).toContain(`data: {"id":"${TRIP_ID}"}`);
    } finally {
      controller.abort();
      await env.close();
    }
  });
});
