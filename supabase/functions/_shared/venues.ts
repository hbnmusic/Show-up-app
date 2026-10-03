import { norm, similarity } from './text.ts';
import type { VenueRow } from './types.ts';

const MATCH = 0.85;

/**
 * Finds a registry venue by name. Matches on the name or an alias; when two venues score about the same the
 * answer is "unknown" rather than a guess. `metro` limits the search when the caller knows the city.
 */
export function resolveVenue(name: string, registry: readonly VenueRow[], metro?: string | null): VenueRow | null {
  const pool = metro ? registry.filter((v) => v.metro === metro) : registry;
  const scored: { v: VenueRow; s: number }[] = [];
  for (const v of pool) {
    let best = 0;
    for (const n of [v.name, ...v.aliases]) {
      const s = norm(n) === norm(name) ? 1 : similarity(n, name);
      if (s > best) best = s;
    }
    if (best >= MATCH) scored.push({ v, s: best });
  }
  scored.sort((a, b) => b.s - a.s);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].v.id !== scored[1].v.id && scored[0].s - scored[1].s < 0.03) return null;
  return scored[0].v;
}

export const ADDRESS_ON_REQUEST = /(?:dm|message|ask|contact|inquire|email|text)\b.{0,25}\baddress|address\s+(?:upon|on|by)\s+request|address\s+(?:tba|tbd|provided|sent|shared)|secret\s+(?:location|show|venue)|location\s+(?:tba|tbd|revealed|disclosed)|adresse\s+(?:sur\s+demande|à\s+venir|a\s+venir)|lieu\s+(?:tba|secret|à\s+confirmer)/i;
