import { isUpcoming } from './filters';
import { priceKnown } from './showText';
import type { Show } from './types';

/**
 * The price filter and the "Cost" line only help when enough of a city's shows say what they cost. Below this share of
 * known prices they are hidden and the card says "On the ticket page" instead. Override with EXPO_PUBLIC_MIN_PRICE_COVERAGE (0 to 1).
 */
const fromEnv = Number(process.env.EXPO_PUBLIC_MIN_PRICE_COVERAGE);
export const MIN_PRICE_COVERAGE = Number.isFinite(fromEnv) && process.env.EXPO_PUBLIC_MIN_PRICE_COVERAGE ? fromEnv : 0.15;

export type PriceCoverage = { upcoming: number; known: number; share: number };

/** Share of the city's upcoming shows with a known price (free, sliding scale, or an amount). */
export function priceCoverage(shows: Show[], metro: string | null | undefined, now: Date): PriceCoverage {
  const upcoming = shows.filter((s) => (!metro || s.venue.metro === metro) && isUpcoming(s, now));
  const known = upcoming.filter(priceKnown).length;
  return { upcoming: upcoming.length, known, share: upcoming.length ? known / upcoming.length : 0 };
}

export function showPriceUi(shows: Show[], metro: string | null | undefined, now: Date, threshold = MIN_PRICE_COVERAGE): boolean {
  const c = priceCoverage(shows, metro, now);
  return c.upcoming > 0 && c.share >= threshold;
}
