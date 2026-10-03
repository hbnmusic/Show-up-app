/**
 * One venue at a time: read its own events page with the cheapest method that works, send what was found to the
 * fp-job function (which re-checks every rule), and record the run. The model is used only when no structured
 * data exists and the page text changed since the last run.
 */
import { clip, extractIcal, extractJsonLd, extractRss, extractWidgetJson, htmlToText, sha256Hex, type RawEvent, type Tier } from '../../supabase/functions/_shared/extract';
import { norm, tokens } from '../../supabase/functions/_shared/text';
import type { RobotsStatus } from '../../supabase/functions/_shared/types';
import type { Outcome, PoliteFetcher } from './polite';

export type PlanVenue = { id: string; metro: string; name: string; website?: string | null; eventsUrl?: string | null; publishMethod?: string | null; tier?: string | null; contentHash?: string | null; etag?: string | null; lastModified?: string | null; address?: string | null };
export type Api = (action: string, body?: Record<string, unknown>) => Promise<Record<string, any>>;
export type Geocode = (v: PlanVenue) => Promise<boolean | null>;

export type ScanResult = { venueId: string; result: 'ingested' | 'ai' | 'unchanged' | 'not_modified' | 'robots' | 'bot_wall' | 'error' | 'quota' | 'no_text' };

const abs = (href: string, base: string) => {
  try {
    return new URL(href.replace(/^webcal:/i, 'https:'), base).toString();
  } catch {
    return null;
  }
};

/** Looks for structured data on the page itself or on feeds the page points to. */
export async function readStructured(url: string, html: string, f: PoliteFetcher): Promise<{ tier: Tier; events: RawEvent[]; pageUrl: string } | null> {
  const ld = extractJsonLd(html, url);
  if (ld.length) return { tier: 'jsonld', events: ld, pageUrl: url };

  const ical = [...html.matchAll(/<link\b[^>]*type=["']text\/calendar["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]).concat([...html.matchAll(/href=["']([^"']+\.ics(?:\?[^"']*)?)["']/gi)].map((m) => m[1]));
  for (const h of ical.slice(0, 2)) {
    const u = abs(h, url);
    if (!u) continue;
    const r = await f.get(u);
    if (r.kind === 'ok') {
      const events = extractIcal(r.body, u);
      if (events.length) return { tier: 'ical', events, pageUrl: u };
    }
  }

  const rss = [...html.matchAll(/<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const h of rss.slice(0, 2)) {
    const u = abs(h, url);
    if (!u) continue;
    const r = await f.get(u);
    if (r.kind === 'ok') {
      const events = extractRss(r.body, u);
      if (events.length) return { tier: 'rss', events, pageUrl: u };
    }
  }

  const origin = new URL(url).origin;
  const endpoints: string[] = [];
  if (/wp-content\/plugins\/the-events-calendar|tribe-events/i.test(html)) endpoints.push(`${origin}/wp-json/tribe/events/v1/events?per_page=100`);
  if (/static\d*\.squarespace\.com|squarespace-cdn\.com/i.test(html)) endpoints.push(`${url}${url.includes('?') ? '&' : '?'}format=json`);
  for (const u of endpoints) {
    const r = await f.get(u);
    if (r.kind !== 'ok') continue;
    try {
      const events = extractWidgetJson(JSON.parse(r.body), u);
      if (events.length) return { tier: 'widget', events, pageUrl: u };
    } catch { /* not JSON */ }
  }
  return null;
}

const robotsOf = (o: Outcome): RobotsStatus | undefined => (o.kind === 'robots_disallowed' ? 'disallowed' : o.kind === 'bot_wall' ? 'bot_wall' : undefined);

export async function scanVenue(v: PlanVenue, f: PoliteFetcher, api: Api): Promise<ScanResult> {
  const url = v.eventsUrl ?? v.website;
  const out = (result: ScanResult['result']): ScanResult => ({ venueId: v.id, result });
  if (!url) {
    await api('record_run', { venueId: v.id, run: { fetchOk: false, note: 'no url' } });
    return out('error');
  }
  const r = await f.get(url, { etag: v.etag, lastModified: v.lastModified });
  if (r.kind === 'robots_disallowed' || r.kind === 'bot_wall') {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, robots: robotsOf(r), note: r.kind } });
    return out(r.kind === 'robots_disallowed' ? 'robots' : 'bot_wall');
  }
  if (r.kind === 'error') {
    await api('record_run', { venueId: v.id, run: { fetchOk: false, note: r.why } });
    return out('error');
  }
  if (r.kind === 'not_modified') {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, note: 'not_modified' } });
    return out('not_modified');
  }
  const fetchInfo = { etag: r.etag, lastModified: r.lastModified };
  const s = await readStructured(url, r.body, f);
  if (s) {
    await api('ingest_events', { venueId: v.id, tier: s.tier, pageUrl: s.pageUrl, events: s.events, run: { fetchOk: true, ...fetchInfo } });
    return out('ingested');
  }
  const text = htmlToText(r.body);
  if (text.length < 200) {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, tier: 'ai', note: 'no_text', ...fetchInfo } });
    return out('no_text');
  }
  const hash = await sha256Hex(text);
  if (hash === v.contentHash) {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, note: 'unchanged', ...fetchInfo } });
    return out('unchanged');
  }
  const res = await api('extract_ai', { venueId: v.id, url, text: clip(text), run: { fetchOk: true, contentHash: hash, ...fetchInfo } });
  return out(res.status === 'quota' ? 'quota' : 'ai');
}

const BIG_VENUE = /\b(stadium|arena|ballpark|speedway|coliseum|raceway)\b/i;

/** Trial read of a candidate venue, then automatic approval or rejection by the rules in approval.ts. */
export async function trialVenue(v: PlanVenue, f: PoliteFetcher, api: Api, geocode: Geocode): Promise<{ venueId: string; decision: string; reasons: string[] }> {
  const url = v.eventsUrl ?? v.website;
  const base = { website: v.website ?? undefined, robots: 'unknown' as RobotsStatus, nameMatches: false, insideMetro: null as boolean | null, structuredEvents: 0, aiEventsWithEvidence: 0, venueTypeOk: !BIG_VENUE.test(v.name) };
  let method: string | null = null;
  const finish = async (checks: typeof base) => {
    const res = await api('approve', { venueId: v.id, checks, method });
    return { venueId: v.id, decision: String(res.decision), reasons: (res.reasons ?? []) as string[] };
  };
  if (!url) return finish(base);
  const r = await f.get(url);
  if (r.kind === 'robots_disallowed') return finish({ ...base, robots: 'disallowed', nameMatches: true, insideMetro: true });
  if (r.kind === 'bot_wall') return finish({ ...base, robots: 'bot_wall', nameMatches: true, insideMetro: true });
  if (r.kind !== 'ok') return finish(base);
  const checks = { ...base, robots: 'ok' as RobotsStatus };
  const text = htmlToText(r.body);
  const nameTokens = tokens(v.name);
  checks.nameMatches = nameTokens.length > 0 && nameTokens.every((t) => norm(text).split(' ').includes(t));
  if (!checks.nameMatches) return finish({ ...checks, insideMetro: true });
  checks.insideMetro = await geocode(v);
  if (checks.insideMetro === false) return finish(checks);
  const s = await readStructured(url, r.body, f);
  if (s) {
    method = s.tier;
    const res = await api('ingest_events', { venueId: v.id, tier: s.tier, pageUrl: s.pageUrl, events: s.events, run: { fetchOk: true, etag: r.etag, lastModified: r.lastModified } });
    checks.structuredEvents = Number(res.ingested ?? 0);
  } else if (text.length >= 200) {
    method = 'ai';
    const res = await api('extract_ai', { venueId: v.id, url, text: clip(text), run: { fetchOk: true, contentHash: await sha256Hex(text), etag: r.etag, lastModified: r.lastModified } });
    checks.aiEventsWithEvidence = Number(res.ingested ?? 0);
    if (res.status === 'quota') return { venueId: v.id, decision: 'deferred', reasons: ['quota'] }; // try again on a later run
  }
  return finish(checks);
}
