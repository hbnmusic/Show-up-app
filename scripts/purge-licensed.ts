/**
 * Removes JamBase listings from the published feed files, for when the provider asks, the terms change, or the
 * jambase_enabled flag is off (see supabase/KILL_SWITCHES.md).
 *
 *   npx tsx scripts/purge-licensed.ts --source jambase --dir listings
 *
 * Also set the switch in Supabase (update fp.licensed_switches set enabled = false where family = 'jambase_listings')
 * so later refreshes stay clean.
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { purgeLicensed } from '../src/lib/licensed';
import { arg } from './lib/api';

const source = arg('source', '');
const dir = arg('dir', 'listings');
if (source !== 'jambase') {
  console.error('Use --source jambase.');
  process.exit(2);
}
let total = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^shows-.+\.json$/.test(n))) {
  const p = path.join(dir, f);
  const feed = JSON.parse(fs.readFileSync(p, 'utf8'));
  const r = purgeLicensed(feed.shows, source);
  feed.shows = r.shows;
  total += r.changed;
  fs.writeFileSync(p, JSON.stringify(feed));
}
console.log(`Purged ${total} ${source} records from ${dir}.`);
