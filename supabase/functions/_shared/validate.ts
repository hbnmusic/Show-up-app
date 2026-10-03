/**
 * Turns what the model read from a flyer into shows we are willing to publish, or reasons for dropping them.
 * The weekday check, the year rule, the coverage filter and the address rule all live here.
 */
import { mapStatedGenres } from './genres.ts';
import { languageFor } from './prompt.ts';
import { ADDRESS_ON_REQUEST, resolveVenue } from './venues.ts';
import { parsePrice, parsePrintedDate, parseTime, resolveDate, todayIn, ymdString, type Lang } from './dates.ts';
import type { ParsedEvent, ParsedFlyer } from './flyerSchema.ts';
import { norm } from './text.ts';
import { licenceFor, type Candidate, type MetroRow, type VenueRow } from './types.ts';

export type Reject = { reason: string; headliner?: string };
export type FlyerOutcome = 'ok' | 'not_flyer' | 'unsafe' | 'no_events';
export type ValidationContext = {
  metros: readonly MetroRow[];
  registry: readonly VenueRow[];
  /** Metro the submitter is looking at; used only when neither the venue nor the printed city says. */
  hintMetro?: string | null;
  now: Date;
  sourceUrl?: string;
  fetchedAt: string;
};

export function metroFromText(text: string | undefined, metros: readonly MetroRow[]): MetroRow | null {
  if (!text) return null;
  const t = ` ${norm(text)} `;
  let found: MetroRow | null = null;
  for (const m of metros) {
    const names = [m.name, ...(m.aliases ?? [])].flatMap((n) => [n, ...n.split(/[–\-/]/)]).map((n) => norm(n)).filter((n) => n.length >= 3);
    if (names.some((n) => t.includes(` ${n} `))) {
      if (found && found.id !== m.id) return null; // two cities named: do not guess
      found = m;
    }
  }
  return found;
}

function cleanUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let u = v.trim().replace(/[),.;]+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u)) return undefined;
    u = `https://${u}`;
  }
  try {
    const url = new URL(u);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function validateEvent(ev: ParsedEvent, ctx: ValidationContext): { candidate: Candidate } | { reject: Reject } {
  const f = ev.fields;
  const headliner = f.headliner?.value;
  if (!headliner) return { reject: { reason: 'no_headliner' } };
  const venueText = f.venue?.value;
  if (!venueText) return { reject: { reason: 'no_venue', headliner } };

  const cityMetro = metroFromText([f.city?.value, f.address?.value].filter(Boolean).join(' '), ctx.metros);
  let venue: VenueRow | null = resolveVenue(venueText, ctx.registry, cityMetro?.id ?? null);
  // A printed city we do not cover (Denver) must not fall back to the submitter's own city.
  const printedCity = f.city?.value?.trim();
  if (!venue && !cityMetro && printedCity) return { reject: { reason: 'not_covered', headliner } };
  if (!venue && !cityMetro) venue = resolveVenue(venueText, ctx.registry, ctx.hintMetro ?? null);
  const metroId = venue?.metro ?? cityMetro?.id ?? ctx.hintMetro ?? null;
  const metro = ctx.metros.find((m) => m.id === metroId);
  if (!metro) return { reject: { reason: metroId ? 'not_covered' : 'metro_unknown', headliner } };
  // A flyer whose printed city is another covered metro than the resolved venue's is contradictory: drop it.
  if (venue && cityMetro && cityMetro.id !== venue.metro) return { reject: { reason: 'venue_city_mismatch', headliner } };

  const lang: Lang = languageFor(metro);
  const printed = parsePrintedDate([f.date?.value, f.weekday?.value].filter(Boolean).join(' '), lang);
  const resolved = resolveDate(printed, todayIn(metro.tz, ctx.now), f.weekday?.value);
  if (!resolved.ok) return { reject: { reason: resolved.reason, headliner } };

  const start = parseTime(f.start?.value);
  const doors = parseTime(f.doors?.value);
  const price = f.price ? parsePrice(f.price.value) : undefined;
  const askAddress = [f.address, f.venue, f.city].some((x) => x && ADDRESS_ON_REQUEST.test(`${x.value} ${x.source}`));
  const useRegistryAddress = !!venue?.address && !askAddress;
  const confidence = Math.min(f.headliner!.confidence, f.venue!.confidence, f.date?.confidence ?? 0);

  const evidence: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) evidence[k] = v.source.slice(0, 120);

  return {
    candidate: {
      sourceType: 'flyer',
      licence: licenceFor('flyer'),
      sourceUrl: ctx.sourceUrl,
      fetchedAt: ctx.fetchedAt,
      metro: metro.id,
      venueId: venue?.id ?? null,
      venueName: venue?.name ?? venueText,
      city: venue ? undefined : f.city?.value ?? metro.name,
      localDate: ymdString(resolved.date),
      startLocal: start ?? undefined,
      doorsLocal: doors ?? undefined,
      headliner,
      supports: ev.supports.map((s) => s.value),
      price: price && Object.keys(price).length ? price : undefined,
      ticketUrl: cleanUrl(f.ticket_url?.value),
      genres: mapStatedGenres(f.genre?.value),
      agePolicy: f.age_policy?.value?.slice(0, 40),
      address: useRegistryAddress ? venue!.address : undefined,
      addressMode: useRegistryAddress ? 'registry' : 'withheld',
      confidence,
      inferredYear: resolved.inferredYear,
      evidence,
    },
  };
}

export function validateFlyer(parsed: ParsedFlyer, ctx: ValidationContext): { outcome: FlyerOutcome; candidates: Candidate[]; rejects: Reject[] } {
  if (!parsed.isSafe) return { outcome: 'unsafe', candidates: [], rejects: [] };
  if (!parsed.isFlyer) return { outcome: 'not_flyer', candidates: [], rejects: [] };
  const candidates: Candidate[] = [];
  const rejects: Reject[] = [];
  for (const ev of parsed.events) {
    const r = validateEvent(ev, ctx);
    if ('candidate' in r) candidates.push(r.candidate);
    else rejects.push(r.reject);
  }
  return { outcome: candidates.length ? 'ok' : 'no_events', candidates, rejects };
}

/**
 * Events the model read from a venue's own page. The venue is already known, so only the date rules apply:
 * a real future date within 12 months, and a printed weekday must match. Passing events publish automatically.
 */
export function validateVenuePage(
  parsed: ParsedFlyer,
  venue: Pick<VenueRow, 'id' | 'name' | 'metro' | 'address'>,
  metro: MetroRow,
  now: Date,
  pageUrl: string,
): { candidates: Candidate[]; rejects: Reject[] } {
  const candidates: Candidate[] = [];
  const rejects: Reject[] = [];
  if (!parsed.isSafe || !parsed.isFlyer) return { candidates, rejects };
  const today = todayIn(metro.tz, now);
  for (const ev of parsed.events) {
    const f = ev.fields;
    if (!f.headliner) { rejects.push({ reason: 'no_headliner' }); continue; }
    const printed = parsePrintedDate([f.date?.value, f.weekday?.value].filter(Boolean).join(' '), languageFor(metro));
    const r = resolveDate(printed, today, f.weekday?.value);
    if (!r.ok) { rejects.push({ reason: r.reason, headliner: f.headliner.value }); continue; }
    const price = f.price ? parsePrice(f.price.value) : undefined;
    candidates.push({
      sourceType: 'venue_site',
      licence: licenceFor('venue_site'),
      sourceUrl: pageUrl,
      fetchedAt: now.toISOString(),
      metro: metro.id,
      venueId: venue.id,
      venueName: venue.name,
      localDate: ymdString(r.date),
      startLocal: parseTime(f.start?.value) ?? undefined,
      doorsLocal: parseTime(f.doors?.value) ?? undefined,
      headliner: f.headliner.value,
      supports: ev.supports.map((x) => x.value),
      price: price && Object.keys(price).length ? price : undefined,
      ticketUrl: cleanUrl(f.ticket_url?.value),
      status: 'scheduled',
      genres: mapStatedGenres(f.genre?.value),
      agePolicy: f.age_policy?.value?.slice(0, 40),
      address: venue.address,
      addressMode: venue.address ? 'registry' : 'withheld',
      inferredYear: r.inferredYear,
      evidence: { tier: 'ai', headliner: f.headliner.source.slice(0, 120), date: f.date?.source.slice(0, 120) ?? '' },
    });
  }
  return { candidates, rejects };
}
