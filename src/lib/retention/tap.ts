/**
 * What opening a retention notification does to the deck. Pure, so it is tested without a phone.
 *   A: the deck shows only the new shows, behind a clearable "New" chip. Filters that would hide some of them are relaxed
 *      and put back when the chip is cleared.
 *   B: the deck is filtered to tonight and the genre named in the notification.
 */
import type { Filters, Genre } from '../types';

export type TapRestore = Pick<Filters, 'when' | 'genres' | 'price'>;

export type TapPlan = {
  /** Filters to apply (merged into the current ones). */
  filters: Partial<Filters>;
  /** Present for A: what to put back when the chip is cleared. */
  restore: TapRestore | null;
  /** Present for A: the deck is limited to these ids. */
  onlyIds: string[] | null;
};

export function planTap(type: 'A' | 'B', genre: Genre | null, newIds: string[], current: Filters): TapPlan {
  if (type === 'B') {
    return { filters: { when: 'tonight', genres: genre ? [genre] : [], price: 'any' }, restore: null, onlyIds: null };
  }
  if (newIds.length === 0) return { filters: {}, restore: null, onlyIds: null };
  return {
    filters: { when: 'all', genres: [], price: 'any' },
    restore: { when: current.when, genres: current.genres, price: current.price },
    onlyIds: newIds,
  };
}

/** The type and genre in a notification's deep link ("/?rt=B&g=Rock"); null when it is not a retention link. */
export function parseTapUrl(url: unknown): { type: 'A' | 'B'; genre: string | null } | null {
  if (typeof url !== 'string') return null;
  const q = url.split('?')[1];
  if (!q) return null;
  const params = new URLSearchParams(q);
  const rt = params.get('rt');
  if (rt !== 'A' && rt !== 'B') return null;
  return { type: rt, genre: params.get('g') };
}
