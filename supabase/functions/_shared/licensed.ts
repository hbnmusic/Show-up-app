/**
 * The licensed layer (JamBase listings) is kept apart from first-party data and has its own on/off switch.
 * Defaults keep today's behaviour: on.
 */
import type { Candidate } from './types.ts';

export type Switches = { jambaseListings: boolean };
export const DEFAULT_SWITCHES: Switches = { jambaseListings: true };

/** Removes switched-off licensed records from a list of candidates before matching and merging. */
export function applySwitches(cands: readonly Candidate[], sw: Switches): Candidate[] {
  return cands.filter((c) => !(c.sourceType === 'jambase' && !sw.jambaseListings));
}

export type ImageChoice = { kind: 'venue'; url: string };

/**
 * Image order after the person's own flyer (which stays on their phone) and before the Deezer artist photo and
 * the generated poster: the venue's own page image (linked, not copied).
 */
export function imageChain(cands: readonly Candidate[]): ImageChoice[] {
  const venue = cands.find((c) => c.sourceType === 'venue_site' && c.imageUrl);
  return venue?.imageUrl ? [{ kind: 'venue', url: venue.imageUrl }] : [];
}
