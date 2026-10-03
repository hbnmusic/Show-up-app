/**
 * The licensed layer (JamBase listings, Ticketmaster price, photo and ticket link) is kept apart from first-party
 * data. Each family has its own on/off switch. Defaults keep today's behaviour: everything on.
 */
import type { Candidate } from './types.ts';

export type Switches = {
  jambaseListings: boolean;
  ticketmasterPrice: boolean;
  ticketmasterPhoto: boolean;
  ticketmasterLink: boolean;
};
export const DEFAULT_SWITCHES: Switches = { jambaseListings: true, ticketmasterPrice: true, ticketmasterPhoto: true, ticketmasterLink: true };

/** Removes switched-off licensed records or fields from a list of candidates before matching and merging. */
export function applySwitches(cands: readonly Candidate[], sw: Switches): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    if (c.sourceType === 'jambase' && !sw.jambaseListings) continue;
    if (c.sourceType === 'ticketmaster') {
      const next = { ...c };
      if (!sw.ticketmasterPrice) delete next.price;
      if (!sw.ticketmasterPhoto) delete next.imageUrl;
      if (!sw.ticketmasterLink) delete next.ticketUrl;
      out.push(next);
      continue;
    }
    out.push(c);
  }
  return out;
}

export type ImageChoice = { kind: 'venue' | 'ticketmaster'; url: string };

/**
 * Image order after the person's own flyer (which stays on their phone) and before the Deezer artist photo and
 * the generated poster: the venue's own page image (linked, not copied), then Ticketmaster if its photo switch is on.
 */
export function imageChain(cands: readonly Candidate[], sw: Switches): ImageChoice[] {
  const out: ImageChoice[] = [];
  const venue = cands.find((c) => c.sourceType === 'venue_site' && c.imageUrl);
  if (venue?.imageUrl) out.push({ kind: 'venue', url: venue.imageUrl });
  const tm = cands.find((c) => c.sourceType === 'ticketmaster' && c.imageUrl);
  if (sw.ticketmasterPhoto && tm?.imageUrl) out.push({ kind: 'ticketmaster', url: tm.imageUrl });
  return out;
}
