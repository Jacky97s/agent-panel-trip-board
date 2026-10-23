import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type AgentApp, type AgentContext, agent, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import { detectIntent } from '../shared/intent.ts';
import { replaceWithOnsen } from '../shared/onsen.ts';
import { BUDGET_LABEL, PLAN_DATE, type Budget, type PlanPrefs, planDay } from '../shared/plans.ts';
import { TRANSPORT_LABEL, type Trip, findStop, parseTrip } from '../shared/trip.ts';

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
      const sessionId = ctx.params.sessionId;
      const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
      const reply = await answer(ctx, sessionId, text);
      if (reply === null) return { stopReason: 'cancelled' as const };
      await say(ctx, sessionId, reply);
      return { stopReason: 'end_turn' as const };
    });
}

/** Runs one prompt and returns the closing message, or null when the user declined a card. */
async function answer(ctx: Ctx, sessionId: string, text: string): Promise<string | null> {
  const file = text.match(/trip path:[ \t]*([^\n]+)/)?.[1]?.trim();
  if (!file) return '沒有看到行程檔的路徑。';
  const trip = await readTrip(ctx, sessionId, file);
  if (!trip) return '讀不到這份行程，或內容格式不正確。';
  const year = Number(trip.days[0]?.date.slice(0, 4)) || 2026;
  const intent = detectIntent(text, year);

  if (intent.type === 'replace-selected') {
    const next = replaceWithOnsen(trip, intent.stopId);
    if (!next) return `找不到景點 ${intent.stopId}，沒有改動。`;
    const written = await writeTrip(ctx, sessionId, file, next.id, (fresh) => replaceWithOnsen(fresh, intent.stopId));
    if (!written) return null;
    return `只把這一站換成「${findStop(written, intent.stopId)?.stop.place ?? ''}」，其他景點都沒動。`;
  }

  if (intent.type === 'plan-day') {
    const date = intent.date;
    if (!date) return '請告訴我要排哪一天，例如「幫我排 11/15」。';
    if (date !== PLAN_DATE) return '示範代理目前只有 11/15（箱根 → 河口湖）的範本，這天我先不動。';
    let prefs = intent.prefs;
    if (intent.ask) {
      const answers = await askBrief(ctx, sessionId);
      if (!answers) return null;
      prefs = { ...prefs, ...answers };
    }
    const next = planDay(trip, date, prefs);
    if (!next) return '這份行程裡沒有 11/15 這一天。';
    const written = await writeTrip(ctx, sessionId, file, next.id, (fresh) => planDay(fresh, date, prefs));
    if (!written) return null;
    return summary(written, prefs);
  }

  return HELP;
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
          oneOf: (['car', 'train'] as const).map((value) => ({ const: value, title: TRANSPORT_LABEL[value] })),
        },
        budget: {
          type: 'string',
          title: '預算',
          oneOf: Object.entries(BUDGET_LABEL).map(([value, title]) => ({ const: value, title })),
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

/**
 * Asks before writing, then re-reads the file and re-applies `edit`, because the user may keep
 * editing the board while the permission card waits.
 */
async function writeTrip(
  ctx: Ctx,
  sessionId: string,
  file: string,
  id: string,
  edit: (trip: Trip) => Trip | null,
): Promise<Trip | null> {
  const title = `寫入 data/trips/${id}.json`;
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
  const allowed = outcome.outcome === 'selected' && outcome.optionId === 'allow';
  const fresh = allowed ? await readTrip(ctx, sessionId, file) : null;
  const trip = fresh && edit(fresh);
  if (!trip) {
    await ctx.client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' },
    });
    return null;
  }
  await ctx.client.request(methods.client.fs.writeTextFile, {
    sessionId,
    path: file,
    content: `${JSON.stringify(trip, null, 2)}\n`,
  });
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' },
  });
  return trip;
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
