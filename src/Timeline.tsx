import { useEffect, useRef, useState } from 'react';
import {
  dayCost,
  formatYen,
  KIND_LABEL,
  moveStop,
  type Stop,
  TIME,
  TRANSPORT_LABEL,
  TRANSPORTS,
  type Transport,
  type Trip,
  updateStop,
} from '../shared/trip.ts';
import type { Selection } from './App.tsx';
import { shortDate, weekday } from './format.ts';

type Props = {
  trip: Trip;
  viewDate: string;
  selection: Selection;
  unresolved: string[];
  flash: Set<string>;
  notice: string;
  onViewDay: (date: string) => void;
  onSelectStop: (date: string, stopId: string) => void;
  onSave: (trip: Trip) => void;
};

const DRAG_TYPE = 'application/x-trip-stop';

export function Timeline({ trip, viewDate, selection, unresolved, flash, notice, onViewDay, onSelectStop, onSave }: Props) {
  const day = trip.days.find((entry) => entry.date === viewDate) ?? trip.days[0];
  const [dropDay, setDropDay] = useState('');
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const focusAfterMove = useRef<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(id)}"]`)?.focus();
  });

  const selectedId = selection?.stopId;
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-stop-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  if (!day) return <section className="reading" />;
  const daySelected = selection?.date === day.date && !selection.stopId;
  const cost = dayCost(day);

  function dropTo(event: React.DragEvent, date: string, index: number) {
    const stopId = event.dataTransfer.getData(DRAG_TYPE);
    setDropDay('');
    setDropIndex(null);
    if (!stopId) return;
    event.preventDefault();
    onSave(moveStop(trip, stopId, date, index));
  }

  return (
    <section className="reading" aria-label="行程">
      <nav className="days" aria-label="日期">
        {trip.days.map((entry) => (
          <button
            key={entry.date}
            type="button"
            className={`day-button${entry.date === day.date ? ' is-current' : ''}${dropDay === entry.date ? ' is-drop' : ''}`}
            aria-pressed={entry.date === day.date}
            onClick={() => onViewDay(entry.date)}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              setDropDay(entry.date);
            }}
            onDragLeave={() => setDropDay('')}
            onDrop={(event) => dropTo(event, entry.date, Number.MAX_SAFE_INTEGER)}
          >
            <span className="day-date">
              {shortDate(entry.date)} <span className="day-weekday">{weekday(entry.date)}</span>
            </span>
            <span className="day-title">{entry.title || '未命名'}</span>
          </button>
        ))}
      </nav>

      <div className="day-scroll">
        <button
          type="button"
          className={`day-head${daySelected ? ' is-selected' : ''}`}
          aria-pressed={daySelected}
          onClick={() => onViewDay(day.date)}
        >
          <span className="day-head-date">
            {shortDate(day.date)} {weekday(day.date)}
          </span>
          <span className="day-head-title">{day.title || '未命名的一天'}</span>
        </button>

        {day.stops.length === 0 ? (
          <p className="empty-day">這天還空著。選這天，請行程助理幫你排。</p>
        ) : (
          <ol className="stops" key={day.date} ref={listRef}>
            {day.stops.map((stop, index) => (
              <StopCard
                key={stop.id}
                stop={stop}
                index={index}
                travelers={trip.travelers}
                selected={selection?.stopId === stop.id}
                showConnector={index > 0}
                unresolved={unresolved.includes(stop.id)}
                flashing={flash.has(stop.id)}
                dropBefore={dropIndex === index}
                onToggle={() => onSelectStop(day.date, stop.id)}
                onPatch={(patch) => onSave(updateStop(trip, stop.id, patch))}
                onMove={(delta) => {
                  const to = index + delta;
                  if (to < 0 || to >= day.stops.length) return;
                  focusAfterMove.current = stop.id;
                  onSave(moveStop(trip, stop.id, day.date, to));
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  event.preventDefault();
                  setDropIndex(index);
                }}
                onDrop={(event) => {
                  const dragged = event.dataTransfer.getData(DRAG_TYPE);
                  const from = day.stops.findIndex((entry) => entry.id === dragged);
                  // moveStop counts the index after removal, so dropping below the origin shifts by one.
                  dropTo(event, day.date, from >= 0 && from < index ? index - 1 : index);
                }}
                onDragEnd={() => setDropIndex(null)}
              />
            ))}
          </ol>
        )}

        <footer className="day-foot">
          <span>本日小計</span>
          <strong>{formatYen(cost)}</strong>
          <span>每人 {formatYen(cost / trip.travelers)}</span>
        </footer>
      </div>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

type CardProps = {
  stop: Stop;
  index: number;
  travelers: number;
  selected: boolean;
  showConnector: boolean;
  unresolved: boolean;
  flashing: boolean;
  dropBefore: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Omit<Stop, 'id'>>) => void;
  onMove: (delta: number) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
};

function StopCard(props: CardProps) {
  const { stop, index, travelers, selected, showConnector, unresolved, flashing, dropBefore } = props;
  const className = [
    'stop',
    selected ? 'is-selected' : '',
    flashing ? 'is-flash' : '',
    dropBefore ? 'is-drop' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-stop-id={stop.id}
      style={{ '--i': index } as React.CSSProperties}
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${stop.time} ${stop.place}`}
      draggable={!selected}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('input, select, label')) return;
        props.onToggle();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          props.onMove(event.key === 'ArrowUp' ? -1 : 1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onToggle();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, stop.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      {showConnector ? <p className="connector">{TRANSPORT_LABEL[stop.transport]}</p> : null}
      <div className="card">
        {selected ? (
          <StopEditor stop={stop} travelers={travelers} onPatch={props.onPatch} />
        ) : (
          <>
            <p className="time">{stop.time}</p>
            <div className="card-body">
              <h3 className="place">{stop.place}</h3>
              <p className="meta">
                <span>{KIND_LABEL[stop.kind]}</span>
                {unresolved ? <span className="unresolved">找不到座標</span> : null}
              </p>
              {stop.notes ? <p className="notes">{stop.notes}</p> : null}
              <p className="cost">
                {stop.cost ? (
                  <>
                    {formatYen(stop.cost)} <span>每人 {formatYen(stop.cost / travelers)}</span>
                  </>
                ) : (
                  '免費'
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function StopEditor({
  stop,
  travelers,
  onPatch,
}: {
  stop: Stop;
  travelers: number;
  onPatch: (patch: Partial<Omit<Stop, 'id'>>) => void;
}) {
  const [time, setTime] = useState(stop.time);
  const [place, setPlace] = useState(stop.place);
  const [notes, setNotes] = useState(stop.notes);
  const [cost, setCost] = useState(String(stop.cost));

  // Agent writes land while the card is open; show them in the fields.
  useEffect(() => setTime(stop.time), [stop.time]);
  useEffect(() => setPlace(stop.place), [stop.place]);
  useEffect(() => setNotes(stop.notes), [stop.notes]);
  useEffect(() => setCost(String(stop.cost)), [stop.cost]);

  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <div className="editor">
      <label className="field field-time">
        <span>時間</span>
        <input
          inputMode="numeric"
          maxLength={5}
          placeholder="HH:mm"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          onKeyDown={blurOnEnter}
          onBlur={() => {
            if (TIME.test(time) && time !== stop.time) onPatch({ time });
            else setTime(stop.time);
          }}
        />
      </label>
      <label className="field field-place">
        <span>地點</span>
        <input
          value={place}
          onChange={(event) => setPlace(event.target.value)}
          onKeyDown={blurOnEnter}
          onBlur={() => {
            const next = place.trim();
            // A new place needs new coordinates, so the old pin must not stay behind.
            if (next && next !== stop.place) onPatch({ place: next, lat: undefined, lng: undefined });
            else setPlace(stop.place);
          }}
        />
      </label>
      <p className="meta">
        <span>{KIND_LABEL[stop.kind]}</span>
      </p>
      <label className="field">
        <span>備註</span>
        <input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onKeyDown={blurOnEnter}
          onBlur={() => {
            if (notes !== stop.notes) onPatch({ notes });
          }}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>交通方式</span>
          <select
            value={stop.transport}
            onChange={(event) => onPatch({ transport: event.target.value as Transport })}
          >
            {TRANSPORTS.map((mode) => (
              <option key={mode} value={mode}>
                {TRANSPORT_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>費用（全團）</span>
          <input
            type="number"
            min={0}
            step={100}
            inputMode="numeric"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            onKeyDown={blurOnEnter}
            onBlur={() => {
              const value = Number(cost);
              if (cost.trim() !== '' && Number.isFinite(value) && value >= 0 && value !== stop.cost) onPatch({ cost: value });
              else setCost(String(stop.cost));
            }}
          />
        </label>
      </div>
      <p className="cost">每人 {formatYen(stop.cost / travelers)}</p>
    </div>
  );
}
