import { isBlockedUrl, safeImage } from './imageGuard';
import type { Show } from './types';

type PreviewActs = { acts: { order: number; status: string; confidence?: string; picture?: string | null }[] } | null | undefined;

export type CardPhoto = { url: string; credit: string };

/**
 * Image order for a card: the person's own shared flyer (kept on the phone), then the image on the venue's own page
 * (linked, not copied), then the Deezer artist photo when the match is confident, else nothing (the app draws a poster).
 * Pictures from blocked hosts never qualify. With Deezer switched off the artist photo is skipped.
 */
export function pickCardPhoto(show: Show, mine: string | undefined, previews: PreviewActs, deezerOn = true): CardPhoto | undefined {
  if (mine && !isBlockedUrl(mine)) return { url: mine, credit: '' };
  const listed = safeImage(show.flyerImages?.[0]);
  if (listed) return { url: listed, credit: show.flyerCredit ?? '' };
  if (!deezerOn || !show.acts.length) return undefined;
  const lead = Math.min(...show.acts.map((x) => x.order));
  const first = previews?.acts.find((a) => a.order === lead);
  const pic = first?.picture ? safeImage(first.picture) : undefined;
  return first && first.status === 'found' && first.confidence === 'high' && pic ? { url: pic, credit: 'DEEZER' } : undefined;
}
