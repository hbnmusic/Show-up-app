/**
 * One venue at a time: read its own events page with the cheapest method that works, send what was found to the
 * fp-job function (which re-checks every rule), and record the run. The model is used only when no structured
 * data exists and the page text changed since the last run.
 */
import { clip, extractIcal, extractJsonLd, extractRss, extractWidgetJson, htmlToText, sha256Hex, type RawEvent, type Tier } from '../../supabase/functions/_shared/extract';
import { norm, tokens } from '../../supabase/functions/_shared/text';
import type { RobotsStatus } from '../../supabase/functions/_shared/types';
import type { Outcome, PoliteFetcher } from './polite';

export type PlanVenue = { id: string; metro: string; name: string; website?: string | null; eventsUrl?: string | null; publishMethod?: string | null; tier?: string | null; contentHash?: string | null; etag?: string | null; lastModified?: string | null; address?: string | null; lat?: number | null; lng?: number | null };
export type Api = (action: string, body?: Record<string, unknown>) => Promise<Record<string, any>>;
export type Geocode = (v: PlanVenue) => Promise<boolean | null>;

export type ScanResult = { venueId: string; result: 'ingested' | 'ai' | 'unchanged' | 'not_modified' | 'robots' | 'bot_wall' | 'error' | 'quota' | 'no_text' };

/**
 * Keeps model requests under the free-tier per-minute limit (15/min): at least `gapMs` between the starts of two
 * extract_ai calls. Other actions pass through untouched.
 */
export function paceAi(api: Api, gapMs = 4500, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Api {
  let last = -Infinity;
  return async (action, body) => {
    if (action === 'extract_ai') {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
    }
    return api(action, body);
  };
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_LIKE = new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, 'gi');

/** Number of date-like strings (Oct 16, 16 October, 2026-10-16, 10/16) in the page text. */
export const countDates = (text: string) => (text.match(DATE_LIKE) ?? []).length;

/** A page with fewer than this many dates cannot list a calendar of shows, so the model is not asked about it. */
export const MIN_DATES_FOR_EVENTS = 3;
export const hasEventText = (text: string) => countDates(text) >= MIN_DATES_FOR_EVENTS;

const LINK_WORDS: [RegExp, number][] = [[/calendar/, 5], [/\bshows?\b/, 5], [/\bevents?\b/, 4], [/upcoming/, 4], [/schedule/, 3], [/concerts?/, 3], [/tickets?/, 1]];
const LINK_AVOID = /private|rental|rent|book(?:ing)?|host|gift|faq|archive|past|press|careers?|jobs?|contact|about|merch|shop|store|donat|volunteer|newsletter|login|account|cart/;
const LINK_FILE = /\.(?:jpe?g|png|gif|webp|svg|pdf|ics|css|js|zip|mp3|mp4)(?:$|\?)/i;
const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, '').toLowerCase();

/**
 * Finds the one link on a page that most likely leads to the venue's own list of shows: same site only (never a
 * ticketing or social site), judged by the link text and path. Returns null when nothing looks like one.
 */
export function findEventsLink(html: string, pageUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return null;
  }
  let best: { url: string; score: number } | null = null;
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href) || LINK_FILE.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || hostOf(u.toString()) !== hostOf(pageUrl)) continue;
    u.hash = '';
    const target = u.toString();
    if (target === new URL(pageUrl).toString() || u.pathname === '/' || u.pathname === '') continue;
    const label = `${decodeURIComponent(u.pathname).toLowerCase()} ${m[2].replace(/<[^>]+>/g, ' ').toLowerCase().trim()}`;
    if (LINK_AVOID.test(label)) continue;
    const score = LINK_WORDS.reduce((sum, [re, w]) => (re.test(label) ? Math.max(sum, w) : sum), 0);
    if (score > 0 && (!best || score > best.score)) best = { url: target, score };
  }
  return best?.url ?? null;
}

/** When the page itself shows no event dates and has no structured data, tries the venue's own shows/events/calendar page. */
async function discoverEventsPage(url: string, html: string, f: PoliteFetcher): Promise<{ url: string; html: string } | null> {
  const link = findEventsLink(html, url);
  if (!link) return null;
  const r = await f.get(link);
  return r.kind === 'ok' ? { url: link, html: r.body } : null;
}

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
  let page = { url, html: r.body };
  let fetchInfo: { etag?: string; lastModified?: string } = { etag: r.etag, lastModified: r.lastModified };
  let s = await readStructured(page.url, page.html, f);
  let text = htmlToText(page.html);
  if (!s && !hasEventText(text)) {
    const found = await discoverEventsPage(page.url, page.html, f);
    if (found) {
      page = found;
      fetchInfo = {}; // the validators belong to the first page, not this one
      s = await readStructured(page.url, page.html, f);
      text = htmlToText(page.html);
    }
  }
  if (s) {
    await api('ingest_events', { venueId: v.id, tier: s.tier, pageUrl: s.pageUrl, events: s.events, run: { fetchOk: true, ...fetchInfo } });
    return out('ingested');
  }
  if (text.length < 200) {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, tier: 'ai', note: 'no_text', ...fetchInfo } });
    return out('no_text');
  }
  if (!hasEventText(text)) {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, tier: 'ai', note: 'no_event_text', ...fetchInfo } });
    return out('no_text'); // nothing on the page looks like a show date, so no model request is spent
  }
  const hash = await sha256Hex(text);
  if (hash === v.contentHash) {
    await api('record_run', { venueId: v.id, run: { fetchOk: true, note: 'unchanged', ...fetchInfo } });
    return out('unchanged');
  }
  const res = await api('extract_ai', { venueId: v.id, url: page.url, text: clip(text), run: { fetchOk: true, contentHash: hash, ...fetchInfo } });
  return out(res.status === 'quota' ? 'quota' : 'ai');
}

const BIG_VENUE = /\b(stadium|arena|ballpark|speedway|coliseum|raceway)\b/i;

/** Trial read of a candidate venue, then automatic approval or rejection by the rules in approval.ts. */
export async function trialVenue(v: PlanVenue, f: PoliteFetcher, api: Api, geocode: Geocode): Promise<{ venueId: string; decision: string; reasons: string[] }> {
  const url = v.eventsUrl ?? v.website;
  const base = { website: v.website ?? undefined, robots: 'unknown' as RobotsStatus, nameMatches: false, insideMetro: null as boolean | null, structuredEvents: 0, aiEventsWithEvidence: 0, venueTypeOk: !BIG_VENUE.test(v.name) };
  let method: string | null = null;
  let eventsUrl: string | null = null;
  const finish = async (checks: typeof base) => {
    const res = await api('approve', { venueId: v.id, checks, method, eventsUrl });
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
  let page = { url, html: r.body };
  let s = await readStructured(page.url, page.html, f);
  let pageText = text;
  if (!s && !hasEventText(pageText)) {
    const found = await discoverEventsPage(page.url, page.html, f);
    if (found) {
      page = found;
      eventsUrl = found.url;
      s = await readStructured(page.url, page.html, f);
      pageText = htmlToText(page.html);
    }
  }
  if (s) {
    method = s.tier;
    const res = await api('ingest_events', { venueId: v.id, tier: s.tier, pageUrl: s.pageUrl, events: s.events, run: { fetchOk: true, ...(eventsUrl ? {} : { etag: r.etag, lastModified: r.lastModified }) } });
    checks.structuredEvents = Number(res.ingested ?? 0);
  } else if (pageText.length >= 200 && hasEventText(pageText)) {
    method = 'ai';
    const res = await api('extract_ai', { venueId: v.id, url: page.url, text: clip(pageText), run: { fetchOk: true, contentHash: await sha256Hex(pageText), ...(eventsUrl ? {} : { etag: r.etag, lastModified: r.lastModified }) } });
    checks.aiEventsWithEvidence = Number(res.ingested ?? 0);
    if (res.status === 'quota') return { venueId: v.id, decision: 'deferred', reasons: ['quota'] }; // try again on a later run
  }
  return finish(checks);
}
