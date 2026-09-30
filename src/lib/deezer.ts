/**
 * Deezer lookups for 30-second previews.
 *
 * Deezer's public API needs no key, but its terms allow non-commercial use
 * only, so this source is for the private prototype. Swap in the provider
 * the spec settles on (artist-supplied links, SoundCloud, Apple) before any
 * public release.
 */

export type ArtistCandidate = {
  id: number;
  name: string;
  fans: number;
  albums: number;
  link?: string;
};

export type Track = {
  title: string;
  artistName: string;
  previewUrl: string;
  link?: string;
};

export type Confidence = 'high' | 'possible';

export type ArtistMatch =
  | { kind: 'match'; artist: ArtistCandidate; confidence: Confidence }
  | { kind: 'none' };

const API = 'https://api.deezer.com';

/** Lowercase, strip accents and punctuation, "&" → "and", collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Names match exactly, or differ only by a leading "the". */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  const strip = (s: string) => s.replace(/^the /, '');
  return x === y || strip(x) === strip(y);
}

/** Bills sometimes list collaborations ("A / B / C"); those rarely have a catalog entry. */
export function isCollaboration(name: string): boolean {
  return /\s\/\s|\bw\/|\bpresents?\b|\bfeat\.?\b/i.test(name);
}

/**
 * Pick the catalog artist for a billed act.
 * - exactly one exact-name match → high confidence
 * - several exact-name matches → the most-followed one, labeled "possible"
 * - none → no preview
 */
export function chooseArtist(
  actName: string,
  candidates: ArtistCandidate[],
  rejectedIds: number[] = [],
): ArtistMatch {
  const exact = candidates.filter(
    (c) => namesMatch(actName, c.name) && !rejectedIds.includes(c.id) && c.albums > 0,
  );
  if (exact.length === 0) return { kind: 'none' };
  const sorted = [...exact].sort((a, b) => b.fans - a.fans);
  // Short or very common names collide with unrelated artists more often.
  const shortName = normalizeName(actName).replace(/^the /, '').length <= 3;
  const confidence: Confidence = exact.length === 1 && !shortName ? 'high' : 'possible';
  return { kind: 'match', artist: sorted[0], confidence };
}

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const body = await res.json();
  if (body && body.error) {
    // Code 4 is Deezer's rate limit; callers retry later.
    throw new Error(`Deezer error ${body.error.code ?? ''}: ${body.error.message ?? 'unknown'}`);
  }
  return body;
}

export async function searchArtists(name: string, signal?: AbortSignal): Promise<ArtistCandidate[]> {
  const body = await getJson(`${API}/search/artist?q=${encodeURIComponent(name)}&limit=10`, signal);
  const data: any[] = Array.isArray(body?.data) ? body.data : [];
  return data.map((a) => ({
    id: Number(a.id),
    name: String(a.name ?? ''),
    fans: Number(a.nb_fan ?? 0),
    albums: Number(a.nb_album ?? 0),
    link: a.link,
  }));
}

export async function topTrack(artistId: number, signal?: AbortSignal): Promise<Track | null> {
  const body = await getJson(`${API}/artist/${artistId}/top?limit=5`, signal);
  const data: any[] = Array.isArray(body?.data) ? body.data : [];
  const t = data.find((x) => typeof x?.preview === 'string' && x.preview.length > 0);
  if (!t) return null;
  return {
    title: String(t.title_short ?? t.title ?? ''),
    artistName: String(t.artist?.name ?? ''),
    previewUrl: t.preview,
    link: t.link,
  };
}
