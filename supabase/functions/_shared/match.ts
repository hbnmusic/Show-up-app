/**
 * One card per show. Records from every source are matched on venue + venue-local night + fuzzy headliner,
 * then merged field by field with a fixed priority. Every field remembers which source supplied it, and
 * disagreements are listed in `conflicts` instead of being resolved silently.
 */
import { similarity } from './text.ts';
import type { Candidate, LicenceClass, ShowStatus, SourceType } from './types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** The night a show belongs to. A start before 5 am belongs to the previous calendar night. */
export function nightOf(localDate: string, startLocal?: string): string {
  if (!startLocal) return localDate;
  const h = Number(startLocal.slice(0, 2));
  if (!(h < 5)) return localDate;
  const [y, m, d] = localDate.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

const minutes = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);

/** Two start times more than this far apart on one night are two shows (early and late). */
const SEPARATE_SHOW_MIN = 120;
const HEADLINER_MATCH = 0.8;

function lineup(c: Candidate): string[] {
  return [c.headliner, ...c.supports];
}

function sameVenue(a: Candidate, b: Candidate): boolean {
  if (a.venueId && b.venueId) return a.venueId === b.venueId;
  return similarity(a.venueName, b.venueName) >= 0.85;
}

/** Headliner matches directly, or appears anywhere in the other record's lineup (support-act order differs between sources). */
function sameAct(a: Candidate, b: Candidate): boolean {
  if (similarity(a.headliner, b.headliner) >= HEADLINER_MATCH) return true;
  const inB = lineup(b).some((n) => similarity(a.headliner, n) >= 0.9);
  const inA = lineup(a).some((n) => similarity(b.headliner, n) >= 0.9);
  return inA && inB;
}

export function sameShow(a: Candidate, b: Candidate): boolean {
  if (nightOf(a.localDate, a.startLocal) !== nightOf(b.localDate, b.startLocal)) return false;
  if (!sameVenue(a, b)) return false;
  if (!sameAct(a, b)) return false;
  const ma = minutes(a.startLocal);
  const mb = minutes(b.startLocal);
  if (ma != null && mb != null && Math.abs(ma - mb) >= SEPARATE_SHOW_MIN) return false;
  return true;
}

/** Groups records that are the same show. A record without a start time joins the first matching group. */
export function cluster(cands: readonly Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const c of cands) {
    // Prefer the group whose start time is closest, so an early and a late show each collect their own records.
    let best = -1;
    let bestGap = Infinity;
    groups.forEach((g, i) => {
      if (!g.some((m) => sameShow(m, c))) return;
      const mc = minutes(c.startLocal);
      const gm = g.map((m) => minutes(m.startLocal)).find((x) => x != null) ?? null;
      const gap = mc != null && gm != null ? Math.abs(mc - gm) : 0;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) groups[best].push(c);
    else groups.push([c]);
  }
  return groups;
}

export type Field = 'start' | 'doors' | 'price' | 'ticketUrl' | 'status' | 'lineup' | 'venue' | 'age' | 'genres' | 'image';

/** Highest priority first. Status is handled separately (cancel and move flags). */
export const PRIORITY: Record<Exclude<Field, 'status'>, SourceType[]> = {
  start: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
  doors: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
  price: ['ticketmaster', 'venue_site', 'jambase', 'flyer'],
  ticketUrl: ['ticketmaster', 'venue_site', 'jambase', 'flyer'],
  lineup: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
  venue: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
  age: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
  genres: ['venue_site', 'flyer', 'jambase', 'ticketmaster'],
  image: ['venue_site', 'ticketmaster', 'jambase', 'flyer'],
};
const STATUS_PRIORITY: SourceType[] = ['jambase', 'ticketmaster', 'venue_site', 'flyer'];

export type SourceRef = { sourceType: SourceType; licence: LicenceClass; url?: string; fetchedAt: string };
export type Conflict = { field: Field; values: { source: SourceType; value: string }[] };

export type MergedShow = {
  /** Venue + night + normalised headliner; stable across refreshes. */
  key: string;
  metro: string | null;
  venueId: string | null;
  venueName: string;
  city?: string;
  address?: string;
  addressMode: 'registry' | 'withheld';
  localDate: string;
  startLocal?: string;
  doorsLocal?: string;
  headliner: string;
  supports: string[];
  price?: Candidate['price'];
  ticketUrl?: string;
  status: ShowStatus;
  genres: Candidate['genres'];
  agePolicy?: string;
  imageUrl?: string;
  fieldSource: Partial<Record<Field, SourceType>>;
  conflicts: Conflict[];
  sources: SourceRef[];
};

const rank = (order: SourceType[], t: SourceType) => {
  const i = order.indexOf(t);
  return i < 0 ? 99 : i;
};
const byPriority = (order: SourceType[]) => (a: Candidate, b: Candidate) => rank(order, a.sourceType) - rank(order, b.sourceType);

const priceText = (p: Candidate['price']) => (!p ? undefined : p.isFree ? 'free' : p.min != null ? `${p.min}-${p.max ?? p.min}` : undefined);
const hasPrice = (c: Candidate) => priceText(c.price) !== undefined;

function pick<T>(group: Candidate[], order: SourceType[], get: (c: Candidate) => T | undefined, show: (v: T) => string, field: Field, out: MergedShow): T | undefined {
  const have = group.filter((c) => get(c) !== undefined).sort(byPriority(order));
  if (!have.length) return undefined;
  const winner = have[0];
  out.fieldSource[field] = winner.sourceType;
  const seen = new Map<string, SourceType>();
  for (const c of have) {
    const v = show(get(c) as T);
    if (!seen.has(v)) seen.set(v, c.sourceType);
  }
  if (seen.size > 1) out.conflicts.push({ field, values: [...seen].map(([value, source]) => ({ source, value })) });
  return get(winner);
}

export function mergeGroup(group: readonly Candidate[]): MergedShow {
  const g = [...group];
  const anchor = [...g].sort(byPriority(PRIORITY.venue))[0];
  const out: MergedShow = {
    key: '',
    metro: anchor.metro,
    venueId: g.find((c) => c.venueId)?.venueId ?? null,
    venueName: anchor.venueName,
    city: anchor.city,
    address: g.find((c) => c.address)?.address,
    addressMode: g.some((c) => c.addressMode === 'registry') ? 'registry' : 'withheld',
    localDate: anchor.localDate,
    headliner: anchor.headliner,
    supports: [],
    status: 'scheduled',
    genres: [],
    fieldSource: { venue: anchor.sourceType },
    conflicts: [],
    sources: [...g].sort(byPriority(PRIORITY.venue)).map((c) => ({ sourceType: c.sourceType, licence: c.licence, url: c.sourceUrl, fetchedAt: c.fetchedAt })),
  };
  const venueNames = new Map<string, SourceType>();
  for (const c of g.sort(byPriority(PRIORITY.venue))) if (!venueNames.has(c.venueName.toLowerCase())) venueNames.set(c.venueName.toLowerCase(), c.sourceType);

  out.startLocal = pick(g, PRIORITY.start, (c) => c.startLocal, (v) => v, 'start', out);
  out.doorsLocal = pick(g, PRIORITY.doors, (c) => c.doorsLocal, (v) => v, 'doors', out);
  out.price = pick(g, PRIORITY.price, (c) => (hasPrice(c) ? c.price : undefined), (v) => priceText(v) ?? '', 'price', out);
  out.ticketUrl = pick(g, PRIORITY.ticketUrl, (c) => c.ticketUrl, (v) => v, 'ticketUrl', out);
  out.agePolicy = pick(g, PRIORITY.age, (c) => c.agePolicy, (v) => v.toLowerCase(), 'age', out);
  out.imageUrl = pick(g, PRIORITY.image, (c) => c.imageUrl, (v) => v, 'image', out);

  // Status: a cancel or move flag from JamBase or Ticketmaster counts, then the venue's own site; a disagreement is flagged.
  const statusHave = g.filter((c) => c.status).sort(byPriority(STATUS_PRIORITY));
  const flagged = statusHave.find((c) => c.status !== 'scheduled' && (c.sourceType === 'jambase' || c.sourceType === 'ticketmaster'));
  const winner = flagged ?? statusHave.find((c) => c.sourceType === 'venue_site') ?? statusHave[0];
  if (winner?.status) {
    out.status = winner.status;
    out.fieldSource.status = winner.sourceType;
    const seen = new Map<string, SourceType>();
    for (const c of statusHave) if (!seen.has(c.status!)) seen.set(c.status!, c.sourceType);
    if (seen.size > 1) out.conflicts.push({ field: 'status', values: [...seen].map(([value, source]) => ({ source, value })) });
  }

  // Lineup: the best source's order first, then anything only other sources list, in their order.
  const ordered = [...g].sort(byPriority(PRIORITY.lineup));
  const names: string[] = [];
  for (const c of ordered) for (const n of lineup(c)) if (!names.some((x) => similarity(x, n) >= 0.9)) names.push(n);
  out.headliner = names[0] ?? out.headliner;
  out.supports = names.slice(1);
  out.fieldSource.lineup = ordered[0].sourceType;
  const lineups = new Map<string, SourceType>();
  for (const c of ordered) {
    const v = lineup(c).map((n) => n.toLowerCase()).sort().join('|');
    if (!lineups.has(v)) lineups.set(v, c.sourceType);
  }
  // Different acts on different sources is normal (support slots added later) but a different headliner is a conflict.
  const heads = new Map<string, SourceType>();
  for (const c of ordered) if (![...heads.keys()].some((h) => similarity(h, c.headliner) >= 0.9)) heads.set(c.headliner, c.sourceType);
  if (heads.size > 1) out.conflicts.push({ field: 'lineup', values: [...heads].map(([value, source]) => ({ source, value })) });

  const genres = ordered.flatMap((c) => c.genres);
  out.genres = [...new Set(genres)].slice(0, 3);
  if (venueNames.size > 1) {
    const vals = [...venueNames].map(([value, source]) => ({ source, value }));
    // Same room spelled two ways is not a conflict when they resolve to one registry venue.
    if (!g.every((c) => c.venueId && c.venueId === out.venueId)) out.conflicts.push({ field: 'venue', values: vals });
  }
  out.key = `${out.venueId ?? out.venueName.toLowerCase()}|${nightOf(out.localDate, out.startLocal)}|${out.headliner.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  return out;
}

export function mergeAll(cands: readonly Candidate[]): MergedShow[] {
  return cluster(cands).map(mergeGroup);
}

/** Text for the "Sources" line in show details, e.g. "Venue website, Ticketmaster, shared flyer". */
export function sourcesLine(m: Pick<MergedShow, 'sources'>): string {
  const label: Record<SourceType, string> = { venue_site: "Venue's website", ticketmaster: 'Ticketmaster', jambase: 'JamBase', flyer: 'Shared flyer' };
  return [...new Set(m.sources.map((s) => label[s.sourceType]))].join(', ');
}
