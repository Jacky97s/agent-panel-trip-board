import fs from 'node:fs/promises';
import type { Capability } from '@agent-panel/core';
import { TRIP_ID } from '../shared/trip.ts';
import { tripPath, tripsDir } from './paths.ts';

export const TRIP_CAPABILITY = 'trip';

const WRITE_TOOLS = ['write', 'Write', 'edit', 'Edit', 'apply_patch', 'str_replace', 'search_replace'];
const READ_TOOLS = ['read', 'Read', 'grep', 'Grep', 'glob', 'Glob', 'ls', 'LS', 'list', 'search'];

export function tripAllowedTools(): string[] {
  return [...WRITE_TOOLS, ...READ_TOOLS];
}

export function createTripCapability(root: string): Capability {
  return {
    id: TRIP_CAPABILITY,
    label: '行程',
    systemPromptAppend: [
      'You plan a trip itinerary by editing ONLY the trip JSON file named in the context as "trip path".',
      'Do not create other files, do not run shell commands, and do not edit application source.',
      'The JSON shape is: id, title, travelers, currency ("JPY"), days.',
      'Each day has date (YYYY-MM-DD), title, and stops. Each stop has id, time (HH:mm), place, kind (sight|meal|onsen|stay|shop|transfer), lat, lng, notes, transport (car|train|bus|walk|ferry|ropeway|flight), cost.',
      'Keep the existing stop ids stable. Give every new stop a unique id.',
      'If a stop id is selected, change only that stop and leave every other stop identical.',
      'Supply lat and lng for every new stop (WGS84, from your own knowledge).',
      'cost is the total for the whole group in JPY (the trip has "travelers" people), not per person. transport is how the group reaches that stop from the previous one.',
      'Write place names and notes in Traditional Chinese.',
      'When the transport mode (self-drive vs train) or the budget is unclear, ask first with an ACP form elicitation (mode form).',
      'The form fields are transport (oneOf car=自駕, train=電車) and budget (oneOf low=省錢, mid=適中, high=不限).',
    ].join('\n'),
    writableRoots: [tripsDir(root)],
    allowedTools: tripAllowedTools(),
    buildContext: async (ctx) => {
      const id = typeof ctx.trip === 'string' && TRIP_ID.test(ctx.trip) ? ctx.trip : '';
      const day = typeof ctx.day === 'string' && ctx.day ? ctx.day : 'none';
      const stop = typeof ctx.stopId === 'string' && ctx.stopId ? ctx.stopId : 'none';
      const lines = [`selected day: ${day}`, `selected stop id: ${stop}`];
      if (!id) return lines;
      const file = tripPath(root, id);
      lines.unshift(`trip path: ${file}`, 'Write only the trip path.');
      try {
        const trip = JSON.parse(await fs.readFile(file, 'utf8')) as { travelers?: number };
        if (typeof trip.travelers === 'number') lines.push(`travelers: ${trip.travelers}`);
      } catch {
        // The agent reads the file itself; a missing or half-written file is not fatal here.
      }
      return lines;
    },
  };
}
