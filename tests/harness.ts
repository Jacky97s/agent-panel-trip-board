import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentApp } from '@agentclientprotocol/sdk';
import { createAgentServer } from '@agent-panel/server';
import { expect } from 'vitest';
import { createApi } from '../server/api.ts';
import { createTripCapability } from '../server/capability.ts';
import { tripsDir } from '../server/paths.ts';

export const TRIP_ID = 'japan-family-2026';

const dirs: string[] = [];

export async function cleanup() {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function start(app?: AgentApp) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'tripboard-'));
  dirs.push(cwd);
  const root = path.join(cwd, 'data');
  await cp(path.join(process.cwd(), 'data/trips'), path.join(root, 'trips'), { recursive: true });
  const api = createApi({ root });
  const agent = app
    ? createAgentServer({
        cwd,
        writableRoots: [tripsDir(root)],
        capabilities: [createTripCapability(root)],
        agent: { app },
      })
    : undefined;
  const http: Server = createServer((req, res) => {
    api(req, res, () => {
      if (agent) void agent.handle(req, res);
      else res.writeHead(404).end();
    });
  });
  agent?.attach(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return {
    root,
    cwd,
    origin,
    base: `${origin}/__agent`,
    tripFile: path.join(tripsDir(root), `${TRIP_ID}.json`),
    close: async () => {
      http.closeAllConnections();
      await agent?.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export type Wire = { type: string; messageId?: string; requestId?: string; message?: string; stopReason?: string; status?: string; fields?: unknown };

export async function openEvents(base: string): Promise<Wire[]> {
  const events: Wire[] = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket failed')));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Wire;
    if (message.type !== 'hello') events.push(message);
  });
  return events;
}

export async function session(base: string): Promise<string> {
  const response = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilityId: 'trip' }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

export async function send(base: string, id: string, text: string, context: Record<string, string>): Promise<number> {
  const response = await fetch(`${base}/sessions/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, capabilityId: 'trip', context }),
  });
  return response.status;
}

export async function respond(base: string, id: string, body: Record<string, unknown>): Promise<number> {
  const response = await fetch(`${base}/sessions/${id}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.status;
}

export function waitFor(events: Wire[], predicate: (event: Wire) => boolean): Promise<Wire> {
  return poll(() => events.find(predicate), () => `events=${JSON.stringify(events)}`);
}

export function poll<T>(probe: () => T | undefined, describe: () => string = () => ''): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = probe();
      if (value !== undefined) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > 8_000) {
        clearInterval(timer);
        reject(new Error(`timed out; ${describe()}`));
      }
    }, 20);
  });
}

export function tripContext(overrides: Record<string, string> = {}): Record<string, string> {
  return { file: `data/trips/${TRIP_ID}.json`, trip: TRIP_ID, day: '', stopId: '', selection: '', ...overrides };
}
