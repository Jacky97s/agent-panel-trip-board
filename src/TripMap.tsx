import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { findStop, type Stop, type Trip } from '../shared/trip.ts';
import { groupPins } from './pins.ts';

type Props = {
  trip: Trip;
  viewDate: string;
  selectedStopId: string | null;
  onSelectStop: (date: string, stopId: string) => void;
};

const JAPAN: L.LatLngTuple = [35.45, 139.25];
const PIN_SIZE = 28;

function point(stop: Stop): L.LatLngTuple | null {
  return stop.lat === undefined || stop.lng === undefined ? null : [stop.lat, stop.lng];
}

export function TripMap({ trip, viewDate, selectedStopId, onSelectStop }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectRef = useRef(onSelectStop);
  selectRef.current = onSelectStop;
  const [zoom, setZoom] = useState(8);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = L.map(host, { zoomControl: true, attributionControl: true }).setView(JAPAN, 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('zoomend', () => setZoom(map.getZoom()));
    // The dock opening resizes this column; Leaflet only measures on window resize.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const day of trip.days) {
      if (day.date === viewDate) continue;
      for (const stop of day.stops) {
        const at = point(stop);
        if (!at) continue;
        L.marker(at, {
          icon: L.divIcon({ className: 'pin-dot', iconSize: [10, 10] }),
          title: stop.place,
          keyboard: false,
        })
          .on('click', () => selectRef.current(day.date, stop.id))
          .addTo(layer);
      }
    }
    const day = trip.days.find((entry) => entry.date === viewDate);
    if (!day) return;
    const points = day.stops.map(point);
    for (const group of groupPins(
      points.map((at) => (at ? map.project(at, zoom) : null)),
      PIN_SIZE,
    )) {
      const stops = group.map((index) => day.stops[index] as Stop);
      const label = group.map((index) => index + 1).join('·');
      const current = stops.findIndex((stop) => stop.id === selectedStopId);
      const selected = current >= 0;
      L.marker(points[group[0] as number] as L.LatLngTuple, {
        icon: L.divIcon({
          className: `pin${selected ? ' is-selected' : ''}`,
          html: `<span>${label}</span>`,
          iconSize: [Math.max(selected ? 36 : PIN_SIZE, 12 + label.length * 9), selected ? 36 : PIN_SIZE],
        }),
        title: group.map((index) => `${index + 1} ${day.stops[index]?.place}`).join('\n'),
        zIndexOffset: selected ? 1000 : 500,
      })
        // Clicking a merged pin again steps to the next stop under it.
        .on('click', () => selectRef.current(day.date, (stops[(current + 1) % stops.length] as Stop).id))
        .addTo(layer);
    }
    const route = points.filter((at) => at !== null);
    if (route.length > 1) {
      L.polyline(route, { color: '#d2381c', weight: 3, opacity: 0.85, interactive: false }).addTo(layer);
    }
  }, [trip, viewDate, selectedStopId, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    const day = trip.days.find((entry) => entry.date === viewDate);
    if (!map || !day) return;
    const points = day.stops.map(point).filter((at) => at !== null);
    // Leaflet drops a view change requested while a zoom animation runs, so quick day switches must not animate.
    if (points.length === 1) map.setView(points[0] as L.LatLngTuple, 13, { animate: false });
    else if (points.length > 1) map.fitBounds(points, { padding: [56, 56], maxZoom: 14, animate: false });
    // Refit only on day change or when the day's coordinates change (agent writes), not on selection.
  }, [viewDate, dayPoints(trip, viewDate)]);

  useEffect(() => {
    const map = mapRef.current;
    const found = selectedStopId ? findStop(trip, selectedStopId) : null;
    const at = found ? point(found.stop) : null;
    if (map && at) map.panTo(at);
  }, [selectedStopId]);

  return <div className="map" ref={hostRef} role="region" aria-label="地圖" />;
}

function dayPoints(trip: Trip, date: string): string {
  const day = trip.days.find((entry) => entry.date === date);
  return day ? day.stops.map((stop) => `${stop.lat},${stop.lng}`).join(';') : '';
}
