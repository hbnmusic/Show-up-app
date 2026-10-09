/**
 * Seeds the venue registry (fp.venues, status "candidate"). Sources allowed: a venue's own site and Wikidata (CC0). Not OpenStreetMap.
 *
 *   npx tsx scripts/seed-venues.ts --wikidata            # SPARQL by class label, all configured metros
 *   npx tsx scripts/seed-venues.ts --file seeds/own.json # [{name, metro, website, eventsUrl?, address?, aliases?}] from venues' own sites
 *   add --dry-run to print instead of sending
 *
 * Needs FP_JOB_URL and JOB_TOKEN unless --dry-run. Candidates only become live after the automatic trial read.
 */
/// <reference types="node" />
import fs from 'node:fs';

import { METROS } from '../src/lib/metros';
import { BOT_PAGE_URL } from '../supabase/functions/_shared/hosting';
import type { SeedVenue } from '../supabase/functions/_shared/jobs';
import { arg, flag, makeApi } from './lib/api';
import { milesBetween } from './lib/geo';

const CLASS_LABELS = ['music venue', 'concert hall', 'nightclub', 'jazz club', 'live music venue'];

export function sparql(): string {
  const values = CLASS_LABELS.map((l) => `"${l}"@en`).join(' ');
  return `SELECT ?item ?itemLabel ?coord ?website WHERE {
  VALUES ?label { ${values} }
  ?class rdfs:label ?label .
  ?item wdt:P31/wdt:P279* ?class .
  ?item wdt:P625 ?coord .
  ?item wdt:P856 ?website .
  FILTER NOT EXISTS { ?item wdt:P576 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
} LIMIT 20000`;
}

type Row = { item: { value: string }; itemLabel: { value: string }; coord: { value: string }; website: { value: string } };

/** Assigns each Wikidata row to the nearest configured metro within its radius. */
export function rowsToSeeds(rows: Row[]): SeedVenue[] {
  const out: SeedVenue[] = [];
  for (const r of rows) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord.value);
    if (!m) continue;
    const p = { lat: Number(m[2]), lng: Number(m[1]) };
    let best: { id: string; mi: number } | null = null;
    for (const metro of METROS) {
      const mi = milesBetween(p, metro);
      if (mi <= metro.radiusMi && (!best || mi < best.mi)) best = { id: metro.id, mi };
    }
    const name = r.itemLabel.value;
    if (!best || /^Q\d+$/.test(name)) continue;
    out.push({ name, metro: best.id, lat: p.lat, lng: p.lng, website: r.website.value, seededFrom: 'wikidata', wikidataId: r.item.value.split('/').pop() });
  }
  return out;
}

async function main() {
  let seeds: SeedVenue[] = [];
  if (flag('wikidata')) {
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql()), { headers: { 'user-agent': `SetnikBot/1.0 (${BOT_PAGE_URL})`, accept: 'application/sparql-results+json' } });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    seeds = rowsToSeeds(((await res.json()) as { results: { bindings: Row[] } }).results.bindings);
  }
  const file = arg('file', '');
  if (file) seeds.push(...(JSON.parse(fs.readFileSync(file, 'utf8')) as SeedVenue[]).map((v) => ({ ...v, seededFrom: 'own_site' as const })));
  console.log(`${seeds.length} candidate venues.`);
  if (flag('dry-run')) return console.log(JSON.stringify(seeds.slice(0, 20), null, 1));
  const api = makeApi();
  let added = 0;
  for (let i = 0; i < seeds.length; i += 200) added += Number((await api('upsert_venues', { venues: seeds.slice(i, i + 200) })).added ?? 0);
  console.log(`Added ${added} new venues.`);
}

if (process.argv[1]?.endsWith('seed-venues.ts')) main().catch((e) => { console.error(e); process.exit(1); });
