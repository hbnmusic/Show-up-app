/**
 * Removes one licensed source from the published feed files, for when a provider asks or the terms change.
 *
 *   npx tsx scripts/purge-licensed.ts --source ticketmaster|jambase --dir listings
 *
 * Ticketmaster: strips price, photo and ticket link that Ticketmaster supplied (and the stamps). JamBase: removes JamBase shows.
 * Also write `{"ticketmaster_price": false, ...}` switches in Supabase (fp.licensed_switches) so later refreshes stay clean.
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { purgeLicensed } from '../src/lib/licensed';
import { arg } from './lib/api';

const source = arg('source', '');
const dir = arg('dir', 'listings');
if (source !== 'ticketmaster' && source !== 'jambase') {
  console.error('Use --source ticketmaster or --source jambase.');
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
