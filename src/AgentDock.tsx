import { useAgentState, useCapability } from '@agent-panel/react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_MODES, type AgentMode, usesOwnSubscription } from '../shared/agent-mode.ts';
import type { Day, Stop } from '../shared/trip.ts';
import { type Inline, parseAgentText } from './agent-text.ts';
import { dayLabel, shortDate } from './format.ts';

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
  day: Day | null;
  selectedStop: Stop | null;
  context: Record<string, string>;
  onClearSelection: () => void;
  onClose: () => void;
};

export function AgentDock({ day, selectedStop, context, onClearSelection, onClose }: Props) {
  const panel = useAgentState();
  const task = useCapability('trip');
  const [draft, setDraft] = useState('');
  const [agent, setAgent] = useState<AgentMode | null>(null);
  const [switching, setSwitching] = useState(false);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch('/api/agent')
      .then((response) => response.json())
      .then((body: { agent: AgentMode }) => setAgent(body.agent))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [panel.items.length, panel.items]);

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
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: next }),
    }).catch(() => null);
    if (!response?.ok) {
      setSwitching(false);
      return;
    }
    window.setTimeout(() => window.location.reload(), 800);
  }

  async function respond(requestId: string, answer: Record<string, unknown>, label: string) {
    if (!panel.sessionId) return;
    setAnswered((current) => ({ ...current, [requestId]: label }));
    const response = await fetch(`/__agent/sessions/${panel.sessionId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, ...answer }),
    }).catch(() => null);
    if (!response?.ok) {
      setAnswered(({ [requestId]: _dropped, ...rest }) => rest);
    }
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
          value={agent ?? 'mock'}
          disabled={!agent || switching || panel.running}
          onChange={(event) => void changeAgent(event.target.value as AgentMode)}
        >
          {AGENT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {AGENT_LABEL[mode]}
            </option>
          ))}
        </select>
        <button type="button" className="quiet" onClick={onClose}>
          收起
        </button>
      </header>
      {agent ? (
        <p className="connection">
          {switching
            ? '正在切換代理，頁面即將重新載入。'
            : usesOwnSubscription(agent)
              ? `agent-panel 透過 ACP 接上你本機的 ${AGENT_LABEL[agent]}，用你自己的訂閱，額外 API 費用 $0。`
              : 'agent-panel 透過 ACP 接上內建的示範 peer，不呼叫任何模型。'}
        </p>
      ) : null}

      <div className="transcript" ref={transcriptRef} aria-live="polite">
        {panel.items.length === 0 ? (
          <p className="intro">
            先選一天或一個行程再開口。你選的東西會跟著訊息一起送給助理，它就知道要改哪裡。
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
  if (item.kind === 'text') return <AgentText text={item.text} />;
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

function AgentText({ text }: { text: string }) {
  return (
    <div className="row-text">
      {parseAgentText(text).map((block, index) =>
        block.kind === 'list' ? (
          <ul key={index}>
            {block.items.map((parts, row) => (
              <li key={row}>
                <Parts parts={parts} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((parts, row) => (
              <span key={row}>
                {row > 0 ? <br /> : null}
                <Parts parts={parts} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function Parts({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : part.text));
}
