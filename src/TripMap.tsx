import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { Trip } from '../shared/trip.ts';

type Props = {
  trip: Trip;
  viewDate: string;
  selectedStopId: string | null;
  onSelectStop: (date: string, stopId: string) => void;
};

const JAPAN: L.LatLngTuple = [35.45, 139.25];

export function TripMap({ trip, viewDate, selectedStopId, onSelectStop }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectRef = useRef(onSelectStop);
  selectRef.current = onSelectStop;

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
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const day of trip.days) {
      if (day.date === viewDate) continue;
      for (const stop of day.stops) {
        if (stop.lat === undefined || stop.lng === undefined) continue;
        L.marker([stop.lat, stop.lng], {
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
    const route: L.LatLngTuple[] = [];
    day.stops.forEach((stop, index) => {
      if (stop.lat === undefined || stop.lng === undefined) return;
      route.push([stop.lat, stop.lng]);
      const selected = stop.id === selectedStopId;
      L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: `pin${selected ? ' is-selected' : ''}`,
          html: `<span>${index + 1}</span>`,
          iconSize: selected ? [36, 36] : [28, 28],
        }),
        title: `${index + 1} ${stop.place}`,
        zIndexOffset: selected ? 1000 : 500,
      })
        .on('click', () => selectRef.current(day.date, stop.id))
        .addTo(layer);
    });
    if (route.length > 1) {
      L.polyline(route, { color: '#d2381c', weight: 3, opacity: 0.85, interactive: false }).addTo(layer);
    }
  }, [trip, viewDate, selectedStopId]);

  useEffect(() => {
    const map = mapRef.current;
    const day = trip.days.find((entry) => entry.date === viewDate);
    if (!map || !day) return;
    const points = day.stops.flatMap((stop) =>
      stop.lat === undefined || stop.lng === undefined ? [] : [[stop.lat, stop.lng] as L.LatLngTuple],
    );
    if (points.length === 1) map.setView(points[0] as L.LatLngTuple, 13);
    else if (points.length > 1) map.fitBounds(points, { padding: [56, 56], maxZoom: 14 });
    // Refit only on day change or when the day's coordinates change (agent writes), not on selection.
  }, [viewDate, dayPoints(trip, viewDate)]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStopId) return;
    for (const day of trip.days) {
      const stop = day.stops.find((entry) => entry.id === selectedStopId);
      if (stop?.lat !== undefined && stop.lng !== undefined) {
        map.panTo([stop.lat, stop.lng]);
        return;
      }
    }
  }, [selectedStopId]);

  return <div className="map" ref={hostRef} role="region" aria-label="地圖" />;
}

function dayPoints(trip: Trip, date: string): string {
  const day = trip.days.find((entry) => entry.date === date);
  return day ? day.stops.map((stop) => `${stop.lat},${stop.lng}`).join(';') : '';
}
