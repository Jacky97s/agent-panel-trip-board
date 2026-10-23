import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentApp, agent, methods } from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createTripAgent } from '../server/mock-trip-agent.ts';
import { parseTrip, type Trip } from '../shared/trip.ts';
import { cleanup, openEvents, poll, respond, send, session, start, tripContext, waitFor } from './harness.ts';

afterEach(cleanup);

const read = async (file: string) => parseTrip(JSON.parse(await readFile(file, 'utf8')));
const day = (trip: Trip, date: string) => trip.days.find((entry) => entry.date === date)!;

describe('trip mock agent over the real bridge', () => {
  it('plans 11/15 after the write permission is allowed', async () => {
    const env = await start(createTripAgent());
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      expect(await send(env.base, id, '幫我排 11/15，自駕，不要太早，晚餐想坐著吃', tripContext({ day: '2026-11-15' }))).toBe(202);
      const permission = await waitFor(events, (event) => event.type === 'permission');
      expect(parseTrip(JSON.parse(await readFile(env.tripFile, 'utf8'))).days[2]?.stops).toHaveLength(1);
      expect(await respond(env.base, id, { requestId: permission.requestId, kind: 'permission', optionId: 'allow' })).toBe(200);
      await waitFor(events, (event) => event.type === 'result');
      const planned = day(await read(env.tripFile), '2026-11-15');
      expect(planned.title).toBe('箱根 → 河口湖');
      expect(planned.stops[0]?.time >= '10:00').toBe(true);
      expect(planned.stops.find((stop) => stop.id === 'd3-dinner')?.time).toBe('18:30');
      expect(planned.stops.find((stop) => stop.id === 'd3-ryokan')).toBeDefined();
    } finally {
      await env.close();
    }
  });

  it('gives every reply its own message id so a second turn shows up in the transcript', async () => {
    const env = await start(createTripAgent());
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, '你好', tripContext());
      await waitFor(events, (event) => event.type === 'result');
      await send(env.base, id, '你可以做什麼', tripContext());
      await poll(() => (events.filter((event) => event.type === 'result').length === 2 ? true : undefined));
      const ids = events.filter((event) => event.type === 'text').map((event) => event.messageId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      await env.close();
    }
  });

  it('keeps an edit the user saved while the write permission was pending', async () => {
    const env = await start(createTripAgent());
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, '幫我排 11/15，自駕', tripContext());
      const permission = await waitFor(events, (event) => event.type === 'permission');
      const edited = await read(env.tripFile);
      edited.days[0]!.stops[0]!.cost = 12345;
      await writeFile(env.tripFile, `${JSON.stringify(edited, null, 2)}\n`);
      await respond(env.base, id, { requestId: permission.requestId, kind: 'permission', optionId: 'allow' });
      await waitFor(events, (event) => event.type === 'result');
      const next = await read(env.tripFile);
      expect(next.days[0]?.stops[0]?.cost).toBe(12345);
      expect(day(next, '2026-11-15').stops.length).toBeGreaterThan(1);
    } finally {
      await env.close();
    }
  });

  it('leaves the file alone when the write is rejected', async () => {
    const env = await start(createTripAgent());
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, '幫我排 11/15，自駕', tripContext());
      const permission = await waitFor(events, (event) => event.type === 'permission');
      await respond(env.base, id, { requestId: permission.requestId, kind: 'permission', optionId: 'reject' });
      await waitFor(events, (event) => event.type === 'result');
      expect(day(await read(env.tripFile), '2026-11-15').stops).toHaveLength(1);
    } finally {
      await env.close();
    }
  });

  it('asks the question card for 幫我排 11/15 and shapes the plan with the answer', async () => {
    const env = await start(createTripAgent());
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, '幫我排 11/15', tripContext());
      const question = await waitFor(events, (event) => event.type === 'question');
      expect(question.message).toBe('先確認一下：這天要自駕還是搭電車？預算抓多少？');
      expect(
        await respond(env.base, id, {
          requestId: question.requestId,
          kind: 'question',
          action: 'accept',
          content: { transport: 'train', budget: 'low' },
        }),
      ).toBe(200);
      const permission = await waitFor(events, (event) => event.type === 'permission');
      await respond(env.base, id, { requestId: permission.requestId, kind: 'permission', optionId: 'allow' });
      await waitFor(events, (event) => event.type === 'result');
      const planned = day(await read(env.tripFile), '2026-11-15');
      expect(planned.stops.some((stop) => stop.transport === 'bus')).toBe(true);
      expect(planned.stops.some((stop) => stop.transport === 'car')).toBe(false);
    } finally {
      await env.close();
    }
  });

  it('replaces only the selected stop with an onsen', async () => {
    const env = await start(createTripAgent());
    try {
      const before = await read(env.tripFile);
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, '這裡換成溫泉', tripContext({ day: '2026-11-14', stopId: 'd2-owakudani' }));
      const permission = await waitFor(events, (event) => event.type === 'permission');
      await respond(env.base, id, { requestId: permission.requestId, kind: 'permission', optionId: 'allow' });
      await waitFor(events, (event) => event.type === 'result');
      const after = await read(env.tripFile);
      expect(after.days.flatMap((d) => d.stops).filter((s) => s.kind === 'onsen')).toHaveLength(1);
      expect(after.days.flatMap((d) => d.stops).find((s) => s.id === 'd2-owakudani')?.time).toBe('15:30');
      expect(after.days.filter((d) => d.date !== '2026-11-14')).toEqual(before.days.filter((d) => d.date !== '2026-11-14'));
    } finally {
      await env.close();
    }
  });

  it('rejects a write outside the trips directory', async () => {
    let failure = '';
    const probe: AgentApp = agent({ name: 'escape-probe' })
      .onRequest(methods.agent.initialize, async (ctx) => ({ protocolVersion: ctx.params.protocolVersion }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'probe' }))
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        try {
          await ctx.client.request(methods.client.fs.writeTextFile, {
            sessionId: ctx.params.sessionId,
            path: path.join(path.dirname(probePath), 'trips', 'inside.json'),
            content: 'ok',
          });
          await ctx.client.request(methods.client.fs.writeTextFile, {
            sessionId: ctx.params.sessionId,
            path: probePath,
            content: 'escaped',
          });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        return { stopReason: 'end_turn' as const };
      });
    const env = await start(probe);
    const probePath = path.join(env.root, 'escape.json');
    try {
      const events = await openEvents(env.base);
      const id = await session(env.base);
      await send(env.base, id, 'write outside', tripContext());
      await waitFor(events, (event) => event.type === 'result');
      expect(failure).not.toBe('');
      expect(await readFile(path.join(env.root, 'trips', 'inside.json'), 'utf8')).toBe('ok');
      await expect(stat(probePath)).rejects.toThrow();
    } finally {
      await env.close();
    }
  });
});
