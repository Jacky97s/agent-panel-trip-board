import { AgentPanelRoot } from '@agent-panel/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findStop, formatYen, type Stop, type Trip, tripCost } from '../shared/trip.ts';
import { AgentDock } from './AgentDock.tsx';
import { tripRange } from './format.ts';
import { Timeline } from './Timeline.tsx';
import { TripMap } from './TripMap.tsx';

export type Selection = { date: string; stopId: string | null } | null;

type TripResponse = { trip: Trip | null; error: string | null; unresolved: string[] };

export function App() {
  return (
    <AgentPanelRoot>
      <Board />
    </AgentPanelRoot>
  );
}

function Board() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [viewDate, setViewDate] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const tripRef = useRef<Trip | null>(null);
  const tripId = trip?.id ?? '';

  const apply = useCallback((next: Trip) => {
    tripRef.current = next;
    setTrip(next);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/trips/${encodeURIComponent(id)}`);
      const body = (await response.json()) as TripResponse;
      // A file caught mid-write comes back as { trip: null }; keep showing the last good trip.
      if (!body.trip) {
        if (!tripRef.current) setLoadError(body.error ?? '讀不到行程');
        return;
      }
      const previous = tripRef.current;
      if (previous) {
        const changed = changedStops(previous, body.trip);
        if (changed.size) {
          setFlash(changed);
          window.setTimeout(() => setFlash(new Set()), 1600);
        }
      }
      setLoadError('');
      setUnresolved(body.unresolved);
      apply(body.trip);
      setViewDate((date) => date || body.trip?.days[0]?.date || '');
    },
    [apply],
  );

  useEffect(() => {
    void fetch('/api/trips')
      .then((response) => response.json())
      .then((body: { trips: { id: string }[] }) => {
        const first = body.trips[0];
        if (first) return load(first.id);
        setLoadError('還沒有行程檔。');
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [load]);

  useEffect(() => {
    if (!tripId) return;
    const events = new EventSource('/api/events');
    events.addEventListener('trip', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { id?: string };
      if (data.id === tripId) void load(tripId);
    });
    return () => events.close();
  }, [tripId, load]);

  const save = useCallback(
    async (next: Trip) => {
      const previous = tripRef.current;
      apply(next);
      setNotice('');
      try {
        const response = await fetch(`/api/trips/${encodeURIComponent(next.id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trip: next }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
      } catch (error) {
        if (previous) apply(previous);
        setNotice(`沒有存到：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [apply],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !selection) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) active.blur();
      setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const selectStop = useCallback((date: string, stopId: string) => {
    setViewDate(date);
    setSelection((current) => (current?.stopId === stopId ? null : { date, stopId }));
  }, []);

  const selectedStop: Stop | null =
    trip && selection?.stopId ? (findStop(trip, selection.stopId)?.stop ?? null) : null;

  const context = useMemo(
    () => ({
      file: `data/trips/${tripId}.json`,
      trip: tripId,
      day: selection?.date ?? '',
      stopId: selection?.stopId ?? '',
      selection: selection ? JSON.stringify({ date: selection.date, stop: selectedStop }) : '',
    }),
    [tripId, selection, selectedStop],
  );

  if (!trip) {
    return (
      <main className="loading">
        <p>{loadError || '載入行程中'}</p>
      </main>
    );
  }

  const total = tripCost(trip);

  return (
    <div className={`app${dockOpen ? ' is-docked' : ''}`}>
      <header className="topbar">
        <h1>{trip.title}</h1>
        <p className="range">{tripRange(trip)}</p>
        <p className="money">
          <span>總計 {formatYen(total)}</span>
          <span>每人 {formatYen(total / trip.travelers)}</span>
        </p>
        <button
          type="button"
          className="assistant-toggle"
          aria-expanded={dockOpen}
          onClick={() => setDockOpen((open) => !open)}
        >
          行程助理
        </button>
      </header>
      <Timeline
        trip={trip}
        viewDate={viewDate}
        selection={selection}
        unresolved={unresolved}
        flash={flash}
        notice={notice || loadError}
        onViewDay={(date) => {
          setViewDate(date);
          setSelection({ date, stopId: null });
        }}
        onSelectStop={selectStop}
        onSave={save}
      />
      <TripMap trip={trip} viewDate={viewDate} selectedStopId={selection?.stopId ?? null} onSelectStop={selectStop} />
      {dockOpen ? (
        <AgentDock
          trip={trip}
          selection={selection}
          selectedStop={selectedStop}
          context={context}
          onClearSelection={() => setSelection(null)}
          onClose={() => setDockOpen(false)}
        />
      ) : null}
    </div>
  );
}

function changedStops(previous: Trip, next: Trip): Set<string> {
  const before = new Map(previous.days.flatMap((day) => day.stops.map((stop) => [stop.id, JSON.stringify(stop)])));
  const changed = new Set<string>();
  for (const stop of next.days.flatMap((day) => day.stops)) {
    if (before.get(stop.id) !== JSON.stringify(stop)) changed.add(stop.id);
  }
  return changed;
}
