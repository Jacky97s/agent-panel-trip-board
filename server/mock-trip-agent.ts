import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type AgentApp, type AgentContext, agent, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import { detectIntent } from '../shared/intent.ts';
import { replaceWithOnsen } from '../shared/onsen.ts';
import { PLAN_DATE, type Budget, type PlanPrefs, planDay } from '../shared/plans.ts';
import { type Trip, findStop, parseTrip } from '../shared/trip.ts';

type Ctx = { client: AgentContext };

const HELP =
  '示範代理可以：幫你排 11/15（箱根 → 河口湖）的一天，或把選取的景點換成附近的溫泉。例如「幫我排 11/15」、「這裡換成溫泉」。';

export function createTripAgent(): AgentApp {
  return agent({ name: 'trip-demo' })
    .onRequest(methods.agent.initialize, async (ctx) => ({
      protocolVersion: ctx.params.protocolVersion,
      agentInfo: { name: 'trip-demo', version: '0.1.0' },
    }))
    .onRequest(methods.agent.session.new, async () => ({ sessionId: Math.random().toString(16).slice(2, 14) }))
    .onNotification(methods.agent.session.cancel, async () => {})
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
      const sessionId = ctx.params.sessionId;
      const file = text.match(/trip path:[ \t]*([^\n]+)/)?.[1]?.trim();
      if (!file) {
        await say(ctx, sessionId, '沒有看到行程檔的路徑。');
        return { stopReason: 'end_turn' as const };
      }
      const trip = await readTrip(ctx, sessionId, file);
      if (!trip) {
        await say(ctx, sessionId, '讀不到這份行程，或內容格式不正確。');
        return { stopReason: 'end_turn' as const };
      }
      const year = Number(trip.days[0]?.date.slice(0, 4)) || 2026;
      const intent = detectIntent(text, year);

      if (intent.type === 'replace-selected') {
        const next = replaceWithOnsen(trip, intent.stopId);
        if (!next) {
          await say(ctx, sessionId, `找不到景點 ${intent.stopId}，沒有改動。`);
          return { stopReason: 'end_turn' as const };
        }
        if (!(await writeTrip(ctx, sessionId, file, next))) return { stopReason: 'cancelled' as const };
        const place = findStop(next, intent.stopId)?.stop.place ?? '';
        await say(ctx, sessionId, `只把這一站換成「${place}」，其他景點都沒動。`);
        return { stopReason: 'end_turn' as const };
      }

      if (intent.type === 'plan-day') {
        if (!intent.date) {
          await say(ctx, sessionId, '請告訴我要排哪一天，例如「幫我排 11/15」。');
          return { stopReason: 'end_turn' as const };
        }
        if (intent.date !== PLAN_DATE) {
          await say(ctx, sessionId, '示範代理目前只有 11/15（箱根 → 河口湖）的範本，這天我先不動。');
          return { stopReason: 'end_turn' as const };
        }
        let prefs = intent.prefs;
        if (intent.ask) {
          const answers = await askBrief(ctx, sessionId);
          if (!answers) return { stopReason: 'cancelled' as const };
          prefs = { ...prefs, ...answers };
        }
        const next = planDay(trip, intent.date, prefs);
        if (!next) {
          await say(ctx, sessionId, '這份行程裡沒有 11/15 這一天。');
          return { stopReason: 'end_turn' as const };
        }
        if (!(await writeTrip(ctx, sessionId, file, next))) return { stopReason: 'cancelled' as const };
        await say(ctx, sessionId, summary(next, prefs));
        return { stopReason: 'end_turn' as const };
      }

      await say(ctx, sessionId, HELP);
      return { stopReason: 'end_turn' as const };
    });
}

function summary(trip: Trip, prefs: Partial<PlanPrefs>): string {
  const first = trip.days.find((entry) => entry.date === PLAN_DATE)?.stops[0]?.time ?? '';
  const parts = [`已排好 11/15，${first}${prefs.late ? ' 才' : ' '}出發`];
  parts.push(prefs.seated ? '晚餐訂了有座位的餺飥店' : '晚餐在河口湖吃餺飥');
  if (prefs.transport === 'train') parts.push('全程搭巴士與步行');
  return `${parts.join('，')}。`;
}

async function askBrief(ctx: Ctx, sessionId: string): Promise<{ transport: 'car' | 'train'; budget: Budget } | null> {
  const answer = await ctx.client.request(methods.client.elicitation.create, {
    mode: 'form',
    sessionId,
    message: '先確認一下：這天要自駕還是搭電車？預算抓多少？',
    requestedSchema: {
      type: 'object',
      properties: {
        transport: {
          type: 'string',
          title: '交通',
          oneOf: [
            { const: 'car', title: '自駕' },
            { const: 'train', title: '電車' },
          ],
        },
        budget: {
          type: 'string',
          title: '預算',
          oneOf: [
            { const: 'low', title: '省錢' },
            { const: 'mid', title: '適中' },
            { const: 'high', title: '不限' },
          ],
        },
      },
    },
  });
  if (answer.action !== 'accept' || !answer.content || typeof answer.content !== 'object') return null;
  const { transport, budget } = answer.content as { transport?: unknown; budget?: unknown };
  return {
    transport: transport === 'train' ? 'train' : 'car',
    budget: budget === 'low' || budget === 'high' ? budget : 'mid',
  };
}

async function readTrip(ctx: Ctx, sessionId: string, file: string): Promise<Trip | null> {
  try {
    const result = await ctx.client.request(methods.client.fs.readTextFile, { sessionId, path: file });
    return parseTrip(JSON.parse(result.content));
  } catch {
    return null;
  }
}

async function writeTrip(ctx: Ctx, sessionId: string, file: string, trip: Trip): Promise<boolean> {
  const title = `寫入 data/trips/${trip.id}.json`;
  // The panel merges tool rows by id, so each write needs its own.
  const toolCallId = `write-trip-${randomUUID()}`;
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call', toolCallId, title, name: 'write', kind: 'edit', status: 'pending', locations: [{ path: file }] },
  });
  const permission = await ctx.client.request(methods.client.session.requestPermission, {
    sessionId,
    toolCall: { toolCallId, title, name: 'write', kind: 'edit', status: 'pending', locations: [{ path: file }] },
    options: [
      { optionId: 'allow', name: '允許寫入', kind: 'allow_once' },
      { optionId: 'reject', name: '拒絕', kind: 'reject_once' },
    ],
  });
  const outcome = permission.outcome;
  if (!(outcome.outcome === 'selected' && outcome.optionId === 'allow')) return false;
  await ctx.client.request(methods.client.fs.writeTextFile, {
    sessionId,
    path: file,
    content: `${JSON.stringify(trip, null, 2)}\n`,
  });
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' },
  });
  return true;
}

async function say(ctx: Ctx, sessionId: string, text: string) {
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', messageId: randomUUID(), content: { type: 'text', text } },
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  const stream = ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  createTripAgent().connect(stream);
}
