import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTrip } from '../shared/trip.ts';
import { cleanup, poll, start, TRIP_ID } from './harness.ts';

afterEach(cleanup);

const putTrip = (origin: string, id: string, trip: unknown, base: string) =>
  fetch(`${origin}/api/trips/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trip, base }),
  });

const version = async (origin: string) =>
  ((await (await fetch(`${origin}/api/trips/${TRIP_ID}`)).json()) as { version: string }).version;

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
        coords: Record<string, { lat: number; lng: number }>;
        unresolved: string[];
      };
      expect(body.trip.days[0]!.stops[0]!.lat).toBeUndefined();
      expect(body.coords).toEqual({ [first!.id]: { lat: 1, lng: 2 } });
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
      const base = await version(env.origin);
      expect((await putTrip(env.origin, TRIP_ID, { ...good, days: 'nope' }, base)).status).toBe(400);
      expect((await putTrip(env.origin, TRIP_ID, { ...good, id: 'other' }, base)).status).toBe(400);
      expect((await putTrip(env.origin, '..%2Fescape', good, base)).status).toBe(400);
      const saved = await putTrip(env.origin, TRIP_ID, { ...good, title: 'renamed' }, base);
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { version: string }).version).toBe(await version(env.origin));
      expect(JSON.parse(await readFile(env.tripFile, 'utf8')).title).toBe('renamed');
    } finally {
      await env.close();
    }
  });

  it('refuses a save based on a version an agent has already replaced', async () => {
    const env = await start();
    try {
      const good = parseTrip(JSON.parse(await readFile(env.tripFile, 'utf8')));
      const base = await version(env.origin);
      await writeFile(env.tripFile, `${JSON.stringify({ ...good, title: 'agent wrote this' }, null, 2)}\n`);
      const response = await putTrip(env.origin, TRIP_ID, { ...good, title: 'stale edit' }, base);
      expect(response.status).toBe(409);
      expect(JSON.parse(await readFile(env.tripFile, 'utf8')).title).toBe('agent wrote this');
    } finally {
      await env.close();
    }
  });

  it('keeps every save when two arrive at once', async () => {
    const env = await start();
    try {
      const good = parseTrip(JSON.parse(await readFile(env.tripFile, 'utf8')));
      const base = await version(env.origin);
      const results = await Promise.all([
        putTrip(env.origin, TRIP_ID, { ...good, title: 'first' }, base),
        putTrip(env.origin, TRIP_ID, { ...good, title: 'second' }, base),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(['first', 'second']).toContain(JSON.parse(await readFile(env.tripFile, 'utf8')).title);
    } finally {
      await env.close();
    }
  });

  it('ignores an agent switch sent as a cross-site simple request', async () => {
    const env = await start();
    try {
      const response = await fetch(`${env.origin}/api/agent`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ agent: 'claude-code' }),
      });
      expect(response.status).toBe(415);
      expect(await (await fetch(`${env.origin}/api/agent`)).json()).toEqual({ agent: 'mock' });
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
