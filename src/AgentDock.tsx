import { useAgentState, useCapability } from '@agent-panel/react';
import { useEffect, useRef, useState } from 'react';
import type { Stop, Trip } from '../shared/trip.ts';
import type { Selection } from './App.tsx';
import { dayLabel, shortDate } from './format.ts';

type AgentMode = 'mock' | 'claude-code' | 'codex';
type Item = ReturnType<typeof useAgentState>['items'][number];

const AGENT_LABEL: Record<AgentMode, string> = {
  mock: 'Mock 示範',
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

const TOOL_STATUS: Record<string, string> = {
  pending: '等待中',
  in_progress: '進行中',
  completed: '完成',
  failed: '失敗',
};

type Props = {
  trip: Trip;
  selection: Selection;
  selectedStop: Stop | null;
  context: Record<string, string>;
  onClearSelection: () => void;
  onClose: () => void;
};

export function AgentDock({ trip, selection, selectedStop, context, onClearSelection, onClose }: Props) {
  const panel = useAgentState();
  const task = useCapability('trip');
  const [draft, setDraft] = useState('');
  const [agent, setAgent] = useState<AgentMode>('mock');
  const [subscription, setSubscription] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch('/api/agent')
      .then((response) => response.json())
      .then((body: { agent: AgentMode; subscription: boolean }) => {
        setAgent(body.agent);
        setSubscription(body.subscription);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [panel.items.length, panel.items]);

  const day = selection ? trip.days.find((entry) => entry.date === selection.date) : undefined;
  const chip = selectedStop ? selectedStop.place : day ? dayLabel(day) : '';
  const suggestions = selectedStop
    ? ['這裡換成溫泉']
    : day
      ? [
          `${shortDate(day.date)} 從箱根到河口湖，不要太早出門，晚餐要坐著吃`,
          `幫我排 ${shortDate(day.date)}`,
        ]
      : [];

  async function changeAgent(next: AgentMode) {
    if (next === agent) return;
    setSwitching(true);
    await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: next }),
    }).catch(() => undefined);
    window.setTimeout(() => window.location.reload(), 800);
  }

  async function respond(requestId: string, answer: Record<string, unknown>, label: string) {
    if (!panel.sessionId) return;
    setAnswered((current) => ({ ...current, [requestId]: label }));
    await fetch(`/__agent/sessions/${panel.sessionId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, ...answer }),
    });
  }

  function send() {
    const text = draft.trim();
    if (!text || panel.running) return;
    setDraft('');
    void task.run(text, context);
  }

  // After a page reload the socket replays old cards; any card followed by a result was already answered.
  const settled = new Set<string>();
  let seenResult = false;
  for (let index = panel.items.length - 1; index >= 0; index -= 1) {
    const item = panel.items[index] as Item;
    if (item.kind === 'result' || item.kind === 'error') seenResult = true;
    else if (seenResult && (item.kind === 'question' || item.kind === 'permission')) settled.add(item.id);
  }

  return (
    <aside className="dock" aria-label="行程助理">
      <header className="dock-head">
        <h2>行程助理</h2>
        <select
          aria-label="代理"
          value={agent}
          disabled={switching || panel.running}
          onChange={(event) => void changeAgent(event.target.value as AgentMode)}
        >
          {(Object.keys(AGENT_LABEL) as AgentMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {AGENT_LABEL[mode]}
            </option>
          ))}
        </select>
        <button type="button" className="quiet" onClick={onClose}>
          收起
        </button>
      </header>
      {subscription ? <p className="subscription">本次使用你自己的訂閱，額外 API 費用 $0</p> : null}
      {switching ? <p className="subscription">正在切換代理，頁面即將重新載入。</p> : null}

      <div className="transcript" ref={transcriptRef} aria-live="polite">
        {panel.items.length === 0 ? (
          <p className="intro">
            選一天或一個行程再開口，助理只會改你選的地方。它只能寫入這趟行程的檔案，每次寫入前都會先問你。
          </p>
        ) : null}
        {panel.items.map((item) => (
          <TranscriptRow
            key={item.id}
            item={item}
            answered={answered[item.id] ?? (settled.has(item.id) ? '' : undefined)}
            onRespond={respond}
          />
        ))}
        {panel.error ? <p className="row-error">{panel.error}</p> : null}
      </div>

      <div className="compose">
        {chip ? (
          <p className="chip">
            <span>已選：{chip}</span>
            <button type="button" aria-label="清除選取" onClick={onClearSelection}>
              ×
            </button>
          </p>
        ) : (
          <p className="chip is-empty">沒有選取，助理會看整趟行程。</p>
        )}
        {suggestions.length ? (
          <div className="suggestions">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                className="suggestion"
                onClick={() => {
                  setDraft(text);
                  composerRef.current?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            ref={composerRef}
            aria-label="訊息"
            rows={3}
            value={draft}
            placeholder="想怎麼排？"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="primary" disabled={panel.running || !draft.trim()}>
            {panel.running ? '處理中' : '送出'}
          </button>
        </form>
      </div>
    </aside>
  );
}

function TranscriptRow({
  item,
  answered,
  onRespond,
}: {
  item: Item;
  answered: string | undefined;
  onRespond: (requestId: string, answer: Record<string, unknown>, label: string) => Promise<void>;
}) {
  if (item.kind === 'user') return <p className="row-user">{item.text}</p>;
  if (item.kind === 'text') return <p className="row-text">{item.text}</p>;
  if (item.kind === 'tool')
    return (
      <p className="row-tool">
        {item.title || item.name} · {TOOL_STATUS[item.status] ?? item.status}
      </p>
    );
  if (item.kind === 'question') return <QuestionCard item={item} answered={answered} onRespond={onRespond} />;
  if (item.kind === 'permission') {
    return (
      <div className="card-ask">
        <p>{item.title}</p>
        {answered !== undefined ? (
          <p className="answered">{answered || '已回覆'}</p>
        ) : (
          <div className="ask-actions">
            {item.options.map((option) => (
              <button
                key={option.optionId}
                type="button"
                className={option.kind.startsWith('allow') ? 'primary' : 'quiet'}
                onClick={() =>
                  void onRespond(
                    item.id,
                    { kind: 'permission', optionId: option.optionId, cancel: option.kind.startsWith('reject') },
                    option.name,
                  )
                }
              >
                {option.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (item.kind === 'result') {
    const label = item.stopReason === 'end_turn' ? '完成' : item.stopReason === 'cancelled' ? '已取消' : '已停止';
    return <p className="row-result">{label}</p>;
  }
  return <p className="row-error">{item.message}</p>;
}

function QuestionCard({
  item,
  answered,
  onRespond,
}: {
  item: Extract<Item, { kind: 'question' }>;
  answered: string | undefined;
  onRespond: (requestId: string, answer: Record<string, unknown>, label: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (answered !== undefined) {
    return (
      <div className="card-ask">
        <p>{item.message}</p>
        <p className="answered">已回答{answered ? `：${answered}` : ''}</p>
      </div>
    );
  }
  const complete = item.fields.every((field) => values[field.name]);
  return (
    <form
      className="card-ask"
      onSubmit={(event) => {
        event.preventDefault();
        const label = item.fields
          .map((field) => field.options?.find((option) => option.value === values[field.name])?.label ?? values[field.name])
          .join('、');
        void onRespond(item.id, { kind: 'question', action: 'accept', content: values }, label);
      }}
    >
      <p>{item.message}</p>
      {item.fields.map((field) => (
        <fieldset key={field.name}>
          <legend>{field.label}</legend>
          {field.options ? (
            <div className="options">
              {field.options.map((option) => (
                <label key={option.value} className="option">
                  <input
                    type="radio"
                    name={`${item.id}-${field.name}`}
                    checked={values[field.name] === option.value}
                    onChange={() => setValues((current) => ({ ...current, [field.name]: option.value }))}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <input
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <button type="submit" className="primary" disabled={!complete}>
        送出回答
      </button>
    </form>
  );
}
