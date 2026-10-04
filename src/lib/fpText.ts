/** Text for the "Sources" line and conflict notes in show details. */
import type { Show } from './types';

const SOURCE_LABEL: Record<string, string> = { venue_site: "Venue's website", jambase: 'JamBase', flyer: 'Shared flyer' };
const FIELD_LABEL: Record<string, string> = { start: 'start time', doors: 'doors time', price: 'price', ticketUrl: 'ticket link', status: 'status', lineup: 'headliner', venue: 'venue', age: 'age limit', genres: 'genre', image: 'image' };

export function sourcesNote(s: Show): string | null {
  const p = s.provenance;
  if (!p || !p.sources.length) return null;
  return `Sources: ${p.line || [...new Set(p.sources.map((x) => SOURCE_LABEL[x.type] ?? x.type))].join(', ')}.`;
}

/** One sentence per disagreement between sources, naming who said what. Empty when everything agrees. */
export function conflictNotes(s: Show): string[] {
  return (s.provenance?.conflicts ?? []).map((c) => {
    const parts = c.values.map((v) => `${SOURCE_LABEL[v.source] ?? v.source}: ${v.value}`).join('; ');
    return `Sources disagree on the ${FIELD_LABEL[c.field] ?? c.field} (${parts}). Check before you go.`;
  });
}

export function ticketLabel(s: Show): string {
  const src = s.provenance?.fieldSource.ticketUrl;
  if (src === 'venue_site') return "Open the venue's page";
  if (s.source.provider === 'jambase') return 'View on JamBase';
  if (s.source.provider === 'community') return 'Open the link';
  if (s.source.provider === 'flyer' || s.source.provider === 'venue_site') return 'Open the link';
  return 'Open listing';
}

export const isFirstParty = (s: Show) => s.id.startsWith('fp:');
