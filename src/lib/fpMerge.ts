/**
 * One card per show in the app. First-party shows (venue pages and shared flyers, from fp_public_shows) are matched
 * against the downloaded JamBase feed on venue + venue-local night + fuzzy headliner and merged field by
 * field with the fixed priorities in supabase/functions/_shared/match.ts. Every field remembers its source and
 * disagreements are kept as conflicts, never resolved silently. Licensed data stays recognisable: JamBase-supplied
 * price, photo and link are split into their own record so the on/off switches and purge can act on them.
 */
import { mergeGroup, sameShow, sourcesLine, type Conflict, type Field } from '../../supabase/functions/_shared/match';
import type { Candidate, SourceType } from '../../supabase/functions/_shared/types';
import { safeImage } from './imageGuard';
import { dedupeKey } from './listings/merge';
import type { Genre, Show } from './types';

export type FpSourceRef = { sourceType: SourceType; licence: string; url?: string; fetchedAt?: string };
export type FpRow = {
  id: string;
  metro: string;
  venueId: string | null;
  venueName: string;
  city?: string | null;
  address?: string | null;
  addressMode: 'registry' | 'withheld';
  localDate: string;
  startLocal?: string | null;
  doorsLocal?: string | null;
  startsAt: string | null;
  doorsAt?: string | null;
  lat?: number | null;
  lng?: number | null;
  headliner: string;
  supports: string[];
  price?: { min?: number; max?: number; isFree?: boolean; notaflof?: boolean } | null;
  ticketUrl?: string | null;
  status: 'scheduled' | 'cancelled' | 'moved';
  genres: string[];
  agePolicy?: string | null;
  imageUrl?: string | null;
  conflicts: Conflict[];
  sources: FpSourceRef[];
  unconfirmed: boolean;
  pending: boolean;
  author?: string | null;
};

/** Provenance kept on a merged show for the "Sources" line and conflict notes. */
export type Provenance = {
  sources: { type: SourceType; licensed: boolean; url?: string }[];
  line: string;
  conflicts: Conflict[];
  fieldSource: Partial<Record<Field, SourceType>>;
  fpId?: string;
  pending?: boolean;
  unconfirmed?: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Reads the RPC result defensively; a malformed row is dropped. */
export function parseFpRows(raw: unknown): FpRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FpRow[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const id = str(r.id);
    const metro = str(r.metro);
    const localDate = str(r.localDate);
    const headliner = str(r.headliner);
    const venueName = str(r.venueName);
    if (!id || !metro || !localDate || !headliner || !venueName || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;
    const startsAt = str(r.startsAt) ?? null;
    if (!startsAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(startsAt)) continue;
    const status = r.status === 'cancelled' || r.status === 'moved' ? r.status : 'scheduled';
    out.push({
      id, metro, venueId: str(r.venueId) ?? null, venueName, city: str(r.city), address: str(r.address), addressMode: r.addressMode === 'registry' ? 'registry' : 'withheld',
      localDate, startLocal: str(r.startLocal), doorsLocal: str(r.doorsLocal), startsAt, doorsAt: str(r.doorsAt),
      lat: typeof r.lat === 'number' ? r.lat : null, lng: typeof r.lng === 'number' ? r.lng : null,
      headliner, supports: Array.isArray(r.supports) ? r.supports.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
      price: isObj(r.price) ? (r.price as FpRow['price']) : null, ticketUrl: str(r.ticketUrl), status,
      genres: Array.isArray(r.genres) ? r.genres.filter((x): x is string => typeof x === 'string') : [], agePolicy: str(r.agePolicy), imageUrl: str(r.imageUrl),
      conflicts: Array.isArray(r.conflicts) ? (r.conflicts as Conflict[]) : [],
      sources: Array.isArray(r.sources) ? (r.sources.filter(isObj) as unknown as FpSourceRef[]) : [],
      unconfirmed: r.unconfirmed === true, pending: r.pending === true, author: str(r.author) ?? null,
    });
  }
  return out;
}

const hhmm = (s?: string | null) => (s ? s.slice(0, 5) : undefined);
const clockDate = (iso: string) => iso.slice(0, 10);
const clockTime = (iso: string) => iso.slice(11, 16);
const offsetOf = (iso: string) => /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1] ?? '+00:00';

function fpCandidates(r: FpRow): Candidate[] {
  const sourceType: SourceType = r.sources.some((s) => s.sourceType === 'venue_site') ? 'venue_site' : 'flyer';
  const url = r.sources.find((s) => s.sourceType === sourceType)?.url;
  return [{
    sourceType, licence: 'first_party', sourceUrl: url, fetchedAt: r.sources[0]?.fetchedAt ?? '', metro: r.metro, venueId: r.venueId, venueName: r.venueName, city: r.city ?? undefined,
    localDate: r.localDate, startLocal: hhmm(r.startLocal), doorsLocal: hhmm(r.doorsLocal), headliner: r.headliner, supports: r.supports,
    price: r.price ?? undefined, ticketUrl: r.ticketUrl ?? undefined, status: r.status, genres: r.genres as Candidate['genres'], agePolicy: r.agePolicy ?? undefined,
    address: r.address ?? undefined, addressMode: r.addressMode, imageUrl: r.imageUrl ?? undefined,
  }];
}

/** A licensed (JamBase-feed) show as a candidate record. */
export function licensedCandidates(s: Show, metro: string): Candidate[] {
  const sorted = [...s.acts].sort((a, b) => a.order - b.order);
  if (!sorted.length || s.source.provider !== 'jambase') return [];
  const base: Candidate = {
    sourceType: 'jambase', licence: 'jambase', sourceUrl: s.source.url, fetchedAt: s.source.fetchedAt, metro, venueId: null, venueName: s.venue.name, city: s.venue.city,
    localDate: clockDate(s.startsAt), startLocal: s.timeTba ? undefined : clockTime(s.startsAt), doorsLocal: s.doorsAt ? clockTime(s.doorsAt) : undefined,
    headliner: sorted[0].name, supports: sorted.slice(1).map((a) => a.name), title: s.title, status: s.status, genres: s.genres as Candidate['genres'], addressMode: 'withheld',
    price: s.price, ticketUrl: s.ticketUrl, imageUrl: safeImage(s.flyerImages?.[0]),
  };
  return [base];
}

/** First-party row on its own (no licensed match). */
function fromRow(r: FpRow): Show {
  const top: SourceType = r.sources.some((s) => s.sourceType === 'venue_site') ? 'venue_site' : 'flyer';
  const sources = r.sources.length ? r.sources : [{ sourceType: top, licence: 'first_party' }];
  const prov: Provenance = {
    sources: sources.map((s) => ({ type: s.sourceType, licensed: false, url: s.url })), line: sourcesLine({ sources: sources.map((s) => ({ sourceType: s.sourceType, licence: 'first_party', url: s.url, fetchedAt: '' })) }),
    conflicts: r.conflicts, fieldSource: {}, fpId: r.id, pending: r.pending, unconfirmed: r.unconfirmed,
  };
  return build(r, null, { ...fpMergedFields(r), startLocal: hhmm(r.startLocal), imageUrl: r.imageUrl ?? undefined }, prov, top);
}

function fpMergedFields(r: FpRow) {
  return { headliner: r.headliner, supports: r.supports, price: r.price ?? undefined, ticketUrl: r.ticketUrl ?? undefined, genres: r.genres, status: r.status, doorsLocal: hhmm(r.doorsLocal), agePolicy: r.agePolicy ?? undefined, venueName: r.venueName, localDate: r.localDate };
}

type Fields = ReturnType<typeof fpMergedFields> & { startLocal?: string; imageUrl?: string };

function build(r: FpRow, lic: Show | null, m: Fields, prov: Provenance, imageSource: SourceType): Show {
  const off = offsetOf(r.startsAt ?? lic?.startsAt ?? '');
  const startsAt = `${m.localDate}T${m.startLocal ?? clockTime(r.startsAt ?? lic?.startsAt ?? 'T20:00')}:00${off}`;
  const doorsAt = m.doorsLocal ? `${m.localDate}T${m.doorsLocal}:00${off}` : undefined;
  const acts = [m.headliner, ...m.supports].map((name, order) => ({ name, order }));
  const address = r.addressMode === 'registry' ? (r.address ?? undefined) : lic?.venue.address;
  const venue = {
    name: m.venueName, neighborhood: lic?.venue.neighborhood ?? '', area: lic?.venue.area ?? '', metro: r.metro,
    lat: r.lat ?? lic?.venue.lat ?? undefined, lng: r.lng ?? lic?.venue.lng ?? undefined, city: r.city ?? lic?.venue.city ?? '',
    address, addressVisibility: address ? ('public' as const) : ('on_request' as const),
  };
  const show: Show = {
    id: lic?.id ?? `fp:${r.id}`, title: lic?.title, startsAt, doorsAt, timeTba: m.startLocal ? undefined : true, venue, acts,
    genres: m.genres as Genre[], price: m.price ?? {}, status: m.status,
    flyerImages: safeImage(m.imageUrl) ? [safeImage(m.imageUrl) as string] : undefined,
    flyerCredit: safeImage(m.imageUrl) ? (imageSource === 'venue_site' ? m.venueName : lic?.flyerCredit) : undefined,
    ticketUrl: m.ticketUrl,
    source: lic?.source ?? { provider: prov.sources[0]?.type === 'venue_site' ? 'venue_site' : 'flyer', url: prov.sources.find((s) => s.url)?.url ?? '', fetchedAt: r.sources[0]?.fetchedAt ?? new Date(0).toISOString(), author: r.author ?? undefined },
    updatedAt: lic?.updatedAt ?? new Date().toISOString(),
    provenance: prov,
  };
  return show;
}

/**
 * Adds the first-party rows to the licensed shows of one city. Rows that match a licensed show are merged into one card
 * (keeping the licensed show's id, so saved decisions still point at it); the rest are added as their own cards.
 */
export function mergeFirstParty(licensed: Show[], rows: FpRow[], metro: string): Show[] {
  const used = new Set<string>();
  const merged = new Map<string, Show>();
  const licCands = licensed.map((s) => ({ s, c: licensedCandidates(s, metro) }));
  for (const r of rows) {
    const [mine] = fpCandidates(r);
    const hit = licCands.find((l) => !used.has(l.s.id) && l.c.length && sameShow(mine, l.c[0]));
    if (!hit) continue;
    used.add(hit.s.id);
    const m = mergeGroup([mine, ...hit.c]);
    const prov: Provenance = {
      sources: m.sources.map((x) => ({ type: x.sourceType, licensed: x.licence !== 'first_party', url: x.url })), line: sourcesLine(m), conflicts: m.conflicts, fieldSource: m.fieldSource,
      fpId: r.id, pending: r.pending, unconfirmed: r.unconfirmed,
    };
    merged.set(hit.s.id, build(r, hit.s, { headliner: m.headliner, supports: m.supports, price: m.price, ticketUrl: m.ticketUrl, genres: m.genres, status: m.status, doorsLocal: m.doorsLocal, agePolicy: m.agePolicy, venueName: m.venueName, localDate: m.localDate, startLocal: m.startLocal, imageUrl: m.imageUrl }, prov, m.fieldSource.image ?? 'venue_site'));
  }
  const out: Show[] = licensed.map((s) => merged.get(s.id) ?? s);
  const taken = new Set(out.map(dedupeKey));
  for (const r of rows) {
    const s = fromRow(r);
    const k = dedupeKey(s);
    if (merged.size && [...merged.values()].some((x) => x.provenance?.fpId === r.id)) continue;
    if (taken.has(k)) continue; // community or manual copy of the same night: keep the earlier card
    taken.add(k);
    out.push(s);
  }
  return out;
}
