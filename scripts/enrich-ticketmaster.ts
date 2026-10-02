/**
 * Fill in price, age policy and a photo on the published city feeds from
 * Ticketmaster's Discovery API. Runs after fetch-listings.ts.
 *
 *   TICKETMASTER_API_KEY=... npx tsx scripts/enrich-ticketmaster.ts
 *
 * A city is enriched when its feed is newer than the last enrichment, or the
 * last enrichment is a week old. Ticketmaster allows 5,000 calls a day and
 * 5 a second, far more than this needs. Nothing here may stop the listings
 * from publishing, so problems are reported as warnings and the feed is left as is.
 *
 * Options: --dir listings  --metros nyc,la  --days 60  --force
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { enrichShow, matchEvent, parseTmEvent, TM_ATTRIBUTION, type TmEvent } from '../src/lib/listings/ticketmaster';
import { parseFeed } from '../src/lib/listings/validate';
import { METROS, type Metro } from '../src/lib/metros';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function warn(message: string) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Ticketmaster::${message.replace(/\r?\n/g, ' ')}` : `Warning: ${message}`);
}

const key = process.env.TICKETMASTER_API_KEY?.replace(/[^\x21-\x7e]/g, '').replace(/^["']|["']$/g, '');
if (!key) {
  console.log('TICKETMASTER_API_KEY is not set; skipping enrichment.');
  process.exit(0);
}

const dir = arg('dir', 'listings');
const days = Number(arg('days', '60'));
const force = process.argv.includes('--force');
const wanted = arg('metros', METROS.map((m) => m.id).join(',')).split(',').map((x) => x.trim());
const base = process.env.TICKETMASTER_BASE_URL ?? 'https://app.ticketmaster.com/discovery/v2';
const now = new Date();
const HOUR = 3600_000;

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const writeAtomic = (file: string, data: unknown) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page of events. The key is in the URL, so errors never print it. */
async function page(params: Record<string, string>): Promise<{ events: unknown[]; totalPages: number }> {
  const q = new URLSearchParams({ ...params, apikey: key! });
  for (let attempt = 0; ; attempt++) {
    await sleep(250); // stay under 5 requests a second
    let res: Response;
    try {
      res = await fetch(`${base}/events.json?${q}`, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new Error(`network error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Ticketmaster refused the key (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`Ticketmaster returned HTTP ${res.status}: ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
    const body = (await res.json()) as { _embedded?: { events?: unknown[] }; page?: { totalPages?: number } };
    return { events: body._embedded?.events ?? [], totalPages: body.page?.totalPages ?? 1 };
  }
}

const isoZ = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** Music events around a city, in two-week windows so each stays under the API's 1,000-result paging limit. */
async function fetchCity(metro: Metro): Promise<{ events: TmEvent[]; calls: number }> {
  const out = new Map<string, TmEvent>();
  let calls = 0;
  for (let from = 0; from < days; from += 14) {
    const start = new Date(now.getTime() + from * 24 * HOUR);
    const end = new Date(now.getTime() + Math.min(days, from + 14) * 24 * HOUR);
    for (let p = 0; p < 5; p++) {
      const r = await page({
        classificationName: 'music',
        latlong: `${metro.lat},${metro.lng}`,
        radius: String(metro.radiusMi),
        unit: 'miles',
        startDateTime: isoZ(start),
        endDateTime: isoZ(end),
        size: '200',
        sort: 'date,asc',
        page: String(p),
      });
      calls++;
      for (const raw of r.events) {
        const ev = parseTmEvent(raw);
        if (ev) out.set(ev.id, ev);
      }
      if (p + 1 >= r.totalPages) break;
    }
  }
  return { events: [...out.values()], calls };
}

type State = { metros: Record<string, { enrichedAt: string }> };

async function main() {
  const state: State = (readJson(path.join(dir, 'tm-state.json')) as State | null) ?? { metros: {} };
  state.metros ??= {};
  let totalCalls = 0;
  let sample = true;

  for (const metro of METROS.filter((m) => wanted.includes(m.id))) {
    const file = path.join(dir, `shows-${metro.id}.json`);
    const parsed = parseFeed(readJson(file));
    if (!parsed || parsed.feed.shows.length === 0) continue;
    const last = state.metros[metro.id]?.enrichedAt;
    const stale = !last || Date.parse(parsed.feed.generatedAt) > Date.parse(last) || now.getTime() - Date.parse(last) > 7 * 24 * HOUR;
    if (!stale && !force) continue;

    try {
      const { events, calls } = await fetchCity(metro);
      totalCalls += calls;
      let matched = 0;
      const count = { price: 0, age: 0, image: 0 };
      const shows = parsed.feed.shows.map((s) => {
        const ev = matchEvent(s, events);
        if (!ev) return s;
        matched++;
        const r = enrichShow(s, ev);
        for (const k of ['price', 'age', 'image'] as const) if (r.fills[k]) count[k]++;
        return r.show;
      });
      console.log(`${metro.name}: ${events.length} Ticketmaster events, ${matched}/${shows.length} shows matched; filled price ${count.price}, age ${count.age}, photo ${count.image} (${calls} calls)`);
      if (sample && events[0]) {
        const e = events[0];
        console.log(`  sample: ${e.venueName} | ${e.attractions.join(', ')} | price ${JSON.stringify(e.price)} | age ${e.age} | image ${e.image ? 'yes' : 'no'}`);
        sample = false;
      }
      const attribution = parsed.feed.attribution.includes(TM_ATTRIBUTION) ? parsed.feed.attribution : [...parsed.feed.attribution, TM_ATTRIBUTION];
      writeAtomic(file, { ...parsed.feed, attribution, shows });
      state.metros[metro.id] = { enrichedAt: now.toISOString() };
    } catch (e) {
      warn(`${metro.name}: ${e instanceof Error ? e.message : String(e)}. Leaving this city's feed as it is.`);
      if (/refused the key/.test(String(e))) break;
    }
  }
  writeAtomic(path.join(dir, 'tm-state.json'), state);
  console.log(`Ticketmaster calls this run: ${totalCalls}`);
}

main().catch((e) => {
  warn(`${e instanceof Error ? e.message : String(e)}`);
});
