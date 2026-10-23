import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { type AgentMode, isAgentMode } from '../shared/agent-mode.ts';
import { type Trip, TRIP_ID, parseTrip } from '../shared/trip.ts';
import { createGeocoder, type Geocoder, type LatLng } from './geocode.ts';
import { agentModePath, tripPath, tripsDir } from './paths.ts';

export async function readAgentMode(root: string): Promise<AgentMode> {
  try {
    const parsed = JSON.parse(await fs.readFile(agentModePath(root), 'utf8')) as { agent?: string };
    if (parsed.agent && isAgentMode(parsed.agent)) return parsed.agent;
  } catch {
    // A missing mode file means the deterministic demo peer.
  }
  return 'mock';
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(options: {
  root: string;
  onAgentChange?: (mode: AgentMode) => void;
}): (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void {
  const geocoder = createGeocoder(options.root);
  const ctx: Context = { ...options, geocoder, changes: new EventEmitter(), writes: new Map() };
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }
    void handle(ctx, url, req, res).catch((error: unknown) => {
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  };
}

type Context = {
  root: string;
  onAgentChange?: (mode: AgentMode) => void;
  geocoder: Geocoder;
  /** Emits a trip id when something other than a file write changes what GET returns (new coordinates). */
  changes: EventEmitter;
  /** Per-trip write chain, so a version check and its write never interleave with another save. */
  writes: Map<string, Promise<unknown>>;
};

async function handle(options: Context, url: URL, req: IncomingMessage, res: ServerResponse) {
  const { root } = options;
  const method = req.method ?? 'GET';

  if (url.pathname === '/api/trips' && method === 'GET') {
    json(res, 200, { trips: await listTrips(root) });
    return;
  }

  const tripMatch = url.pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (tripMatch) {
    const id = decodeURIComponent(tripMatch[1] ?? '');
    if (!TRIP_ID.test(id)) throw new HttpError(400, 'invalid trip id');
    if (method === 'GET') {
      json(res, 200, await readTripWithCoordinates(options, id));
      return;
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      let trip: Trip;
      try {
        trip = parseTrip(body.trip);
        if (trip.id !== id) throw new Error(`trip.id must equal ${id}`);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const base = typeof body.base === 'string' ? body.base : '';
      json(res, 200, { trip, version: await saveTrip(options, trip, base) });
      return;
    }
  }

  if (url.pathname === '/api/events' && method === 'GET') {
    streamEvents(options, req, res);
    return;
  }

  if (url.pathname === '/api/agent' && method === 'GET') {
    const agent = await readAgentMode(root);
    json(res, 200, { agent });
    return;
  }
  if (url.pathname === '/api/agent' && method === 'POST') {
    const body = await readBody(req);
    const agent = typeof body.agent === 'string' ? body.agent : '';
    if (!isAgentMode(agent)) throw new HttpError(400, '未知的代理');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(agentModePath(root), `${JSON.stringify({ agent }, null, 2)}\n`);
    json(res, 200, { agent, restarting: true });
    options.onAgentChange?.(agent);
    return;
  }
  throw new HttpError(404, 'not found');
}

async function listTrips(root: string): Promise<{ id: string; title: string }[]> {
  const names = await fs.readdir(tripsDir(root)).catch(() => [] as string[]);
  const trips = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const trip = parseTrip(JSON.parse(await fs.readFile(path.join(tripsDir(root), name), 'utf8')));
          return trip.id === name.slice(0, -'.json'.length) ? { id: trip.id, title: trip.title } : null;
        } catch {
          return null;
        }
      }),
  );
  return trips.filter((trip): trip is { id: string; title: string } => trip !== null).sort((a, b) => a.id.localeCompare(b.id));
}

async function readTripWithCoordinates({ root, geocoder, changes }: Context, id: string) {
  let raw: string;
  let trip: Trip;
  try {
    raw = await fs.readFile(tripPath(root, id), 'utf8');
    trip = parseTrip(JSON.parse(raw));
  } catch (error) {
    return { trip: null, error: error instanceof Error ? error.message : String(error), unresolved: [] as string[] };
  }
  const coords: Record<string, LatLng> = {};
  const unresolved: string[] = [];
  const pending: string[] = [];
  for (const stop of trip.days.flatMap((day) => day.stops)) {
    if (stop.lat !== undefined) continue;
    const cached = await geocoder.cached(stop.place);
    if (cached) coords[stop.id] = cached;
    else unresolved.push(stop.id);
    if (cached === undefined) pending.push(stop.place);
  }
  // Nominatim allows one request a second, so lookups run after the response and announce themselves over SSE.
  if (pending.length) {
    void Promise.all(pending.map((place) => geocoder.lookup(place).catch(() => undefined))).then((found) => {
      if (found.some(Boolean)) changes.emit('trip', id);
    });
  }
  return { trip, version: versionOf(raw), coords, error: null, unresolved };
}

function versionOf(raw: string): string {
  return createHash('sha1').update(raw).digest('hex');
}

function saveTrip({ root, writes }: Context, trip: Trip, base: string): Promise<string> {
  const run = (writes.get(trip.id) ?? Promise.resolve()).then(async () => {
    const file = tripPath(root, trip.id);
    const current = await fs.readFile(file, 'utf8').catch(() => '');
    if (current && versionOf(current) !== base) {
      throw new HttpError(409, '行程已經被更新，請重新載入後再改');
    }
    const content = `${JSON.stringify(trip, null, 2)}\n`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = path.join(path.dirname(file), `.${trip.id}.${randomUUID()}.tmp`);
    await fs.writeFile(temp, content);
    await fs.rename(temp, file);
    return versionOf(content);
  });
  writes.set(trip.id, run.catch(() => undefined));
  return run;
}

function streamEvents({ root, changes }: Context, req: IncomingMessage, res: ServerResponse) {
  const timers = new Map<string, NodeJS.Timeout>();
  const announce = (id: string) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        res.write(`event: trip\ndata: ${JSON.stringify({ id })}\n\n`);
      }, 80),
    );
  };
  // Created before the headers go out, so a missing trips folder is a 500 instead of a silent stream.
  const watcher = watch(tripsDir(root), (_event, name) => {
    const file = name?.toString() ?? '';
    if (file.endsWith('.json')) announce(file.slice(0, -'.json'.length));
  });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  changes.on('trip', announce);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  const stop = () => {
    clearInterval(ping);
    for (const timer of timers.values()) clearTimeout(timer);
    changes.off('trip', announce);
    watcher.close();
  };
  watcher.on('error', () => {
    stop();
    res.end();
  });
  req.on('close', stop);
}

function json(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const value = chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}
