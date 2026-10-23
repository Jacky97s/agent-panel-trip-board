import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { type Trip, TRIP_ID, parseTrip } from '../shared/trip.ts';
import { createGeocoder } from './geocode.ts';
import { agentModePath, tripPath, tripsDir } from './paths.ts';

export type AgentMode = 'mock' | 'claude-code' | 'codex';

const MODES: AgentMode[] = ['mock', 'claude-code', 'codex'];

export function isAgentMode(value: string): value is AgentMode {
  return (MODES as string[]).includes(value);
}

export async function readAgentMode(root: string): Promise<AgentMode> {
  try {
    const parsed = JSON.parse(await fs.readFile(agentModePath(root), 'utf8')) as { agent?: string };
    if (parsed.agent && isAgentMode(parsed.agent)) return parsed.agent;
  } catch {
    // A missing mode file means the deterministic demo peer.
  }
  return 'mock';
}

export function showsSubscriptionNote(mode: AgentMode): boolean {
  return mode === 'claude-code' || mode === 'codex';
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
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }
    void handle(options, geocoder, url, req, res).catch((error: unknown) => {
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  };
}

async function handle(
  options: { root: string; onAgentChange?: (mode: AgentMode) => void },
  geocoder: ReturnType<typeof createGeocoder>,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
) {
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
      json(res, 200, await readTripWithCoordinates(root, id, geocoder));
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
      await writeTripFile(root, trip);
      json(res, 200, { trip });
      return;
    }
  }

  if (url.pathname === '/api/events' && method === 'GET') {
    streamEvents(root, req, res);
    return;
  }

  if (url.pathname === '/api/agent' && method === 'GET') {
    const agent = await readAgentMode(root);
    json(res, 200, { agent, subscription: showsSubscriptionNote(agent) });
    return;
  }
  if (url.pathname === '/api/agent' && method === 'POST') {
    const body = await readBody(req);
    const agent = typeof body.agent === 'string' ? body.agent : '';
    if (!isAgentMode(agent)) throw new HttpError(400, '未知的代理');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(agentModePath(root), `${JSON.stringify({ agent }, null, 2)}\n`);
    json(res, 200, { agent, subscription: showsSubscriptionNote(agent), restarting: true });
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

async function readTripWithCoordinates(root: string, id: string, geocoder: ReturnType<typeof createGeocoder>) {
  let trip: Trip;
  try {
    trip = parseTrip(JSON.parse(await fs.readFile(tripPath(root, id), 'utf8')));
  } catch (error) {
    return { trip: null, error: error instanceof Error ? error.message : String(error), unresolved: [] as string[] };
  }
  const unresolved: string[] = [];
  for (const day of trip.days) {
    for (const stop of day.stops) {
      if (stop.lat !== undefined) continue;
      const found = await geocoder.lookup(stop.place).catch(() => undefined);
      if (found) {
        stop.lat = found.lat;
        stop.lng = found.lng;
      } else unresolved.push(stop.id);
    }
  }
  return { trip, error: null, unresolved };
}

async function writeTripFile(root: string, trip: Trip) {
  const file = tripPath(root, trip.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${trip.id}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(trip, null, 2)}\n`);
  await fs.rename(temp, file);
}

function streamEvents(root: string, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher = watch(tripsDir(root), (_event, name) => {
    const file = name?.toString() ?? '';
    if (!file.endsWith('.json')) return;
    const id = file.slice(0, -'.json'.length);
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        res.write(`event: trip\ndata: ${JSON.stringify({ id })}\n\n`);
      }, 80),
    );
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    for (const timer of timers.values()) clearTimeout(timer);
    watcher.close();
  });
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
