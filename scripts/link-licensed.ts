/**
 * Matches published first-party shows against the downloaded JamBase feed and records the match as ids only
 * (fp.licensed_links). No JamBase or Ticketmaster field is copied into first-party tables.
 * A match counts as a corroborating source, which lets a pending flyer show go live when its confidence is high.
 *
 *   FP_JOB_URL=... JOB_TOKEN=... npx tsx scripts/link-licensed.ts --dir listings
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { parseFeed } from '../src/lib/listings/validate';
import { metroById } from '../src/lib/metros';
import type { Show } from '../src/lib/types';
import { toLocal } from '../supabase/functions/_shared/extract';
import { sameShow } from '../supabase/functions/_shared/match';
import type { Candidate } from '../supabase/functions/_shared/types';
import { arg, makeApi } from './lib/api';

type Exported = { id: string; metro: string; venue_id: string | null; venue_name: string; d: string; start_local?: string | null; headliner: string; supports?: string[] | null };

const asCandidate = (e: Exported): Candidate => ({ sourceType: 'venue_site', licence: 'first_party', fetchedAt: '', metro: e.metro, venueId: e.venue_id, venueName: e.venue_name, localDate: e.d, startLocal: e.start_local?.slice(0, 5) ?? undefined, headliner: e.headliner, supports: e.supports ?? [], genres: [], addressMode: 'withheld' });

export function licensedCandidate(s: Show, metro: string): Candidate | null {
  const tz = metroById(metro)?.tz ?? 'America/New_York';
  const l = toLocal(s.startsAt, tz);
  if (!l) return null;
  const sorted = [...s.acts].sort((a, b) => a.order - b.order);
  if (!sorted.length) return null;
  return { sourceType: 'jambase', licence: 'jambase', fetchedAt: '', metro, venueId: null, venueName: s.venue.name, localDate: l.date, startLocal: s.timeTba ? undefined : l.time, headliner: sorted[0].name, supports: sorted.slice(1).map((a) => a.name), genres: [], addressMode: 'withheld' };
}

export function matchLinks(own: Exported[], feedShows: { show: Show; metro: string }[]): { showId: string; source: 'jambase'; externalId: string }[] {
  const links: { showId: string; source: 'jambase'; externalId: string }[] = [];
  const seen = new Set<string>();
  for (const e of own) {
    const a = asCandidate(e);
    for (const { show, metro } of feedShows) {
      if (metro !== e.metro || show.source.provider !== 'jambase') continue;
      const b = licensedCandidate(show, metro);
      if (b && sameShow(a, b) && !seen.has(e.id)) {
        seen.add(e.id);
        links.push({ showId: e.id, source: 'jambase', externalId: show.id });
      }
    }
  }
  return links;
}

async function main() {
  const dir = arg('dir', 'listings');
  const feedShows: { show: Show; metro: string }[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => /^shows-.+\.json$/.test(n))) {
    const parsed = parseFeed(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const metro = f.replace(/^shows-|\.json$/g, '');
    for (const show of parsed?.feed.shows ?? []) feedShows.push({ show, metro });
  }
  const api = makeApi();
  const own = ((await api('export_shows')).shows ?? []) as Exported[];
  const links = matchLinks(own, feedShows);
  console.log(`${own.length} first-party shows, ${feedShows.length} licensed shows, ${links.length} matches.`);
  if (links.length) console.log(`Recorded ${(await api('licensed_link', { links })).linked} links.`);
}

if (process.argv[1]?.endsWith('link-licensed.ts')) main().catch((e) => { console.error(e); process.exit(1); });
