import path from 'node:path';
import { TRIP_ID } from '../shared/trip.ts';

export function dataDir(): string {
  return path.resolve(process.env.TRIP_DATA ?? path.join(process.cwd(), 'data'));
}

export function tripsDir(root = dataDir()): string {
  return path.join(root, 'trips');
}

export function tripPath(root: string, id: string): string {
  if (!TRIP_ID.test(id)) throw new Error('invalid trip id');
  return path.join(tripsDir(root), `${id}.json`);
}

export function geocodePath(root = dataDir()): string {
  return path.join(root, 'cache', 'geocode.json');
}

export function agentModePath(root = dataDir()): string {
  return path.join(root, 'runtime-agent.json');
}
