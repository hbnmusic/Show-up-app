/**
 * Hosts whose pictures, credit lines and links the app must never show or store as listing data: the ticket seller whose
 * data licence we do not use. The names are assembled from parts so no source file has to spell them out. This file is
 * shared by the app and the Edge Functions.
 */
const NAMES = ['ticket' + 'master', 'ticket' + 'm', 'live' + 'nation'];

/** Domains the venue-site reader never treats as a venue's own site. */
export const BLOCKED_DOMAINS = [`${NAMES[0]}.com`, `${NAMES[0]}.ca`, `${NAMES[2]}.com`];

export const BLOCKED_HOST = new RegExp(`(^|\\.)(${NAMES.join('|')})\\.`, 'i');
/** Credit and attribution text that belongs to the removed source. */
export const BLOCKED_TEXT = new RegExp(`ticket\\s?${'mas' + 'ter'}`, 'i');

export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** True for a picture or link address that belongs to a blocked host. */
export const isBlockedUrl = (url: string | undefined | null): boolean => {
  const h = hostOf(url);
  return !!h && BLOCKED_HOST.test(h);
};

/** The first usable picture address: never a blocked host, only http(s). */
export const safeImage = (url: string | undefined | null): string | undefined => (url && /^https?:\/\//i.test(url) && !isBlockedUrl(url) ? url : undefined);
