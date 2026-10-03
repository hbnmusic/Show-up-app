/**
 * Applies the licensed-layer switches to the published feed files, so switched-off data never ships.
 *   npx tsx scripts/apply-switches.ts --dir listings --switches listings/licensed-switches.json
 * The switches file is the output of the public RPC fp_licensed_switches; a missing file means defaults (everything on).
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { applySwitchesToAll, DEFAULT_LICENSED, parseSwitches } from '../src/lib/licensed';
import { arg } from './lib/api';

const dir = arg('dir', 'listings');
const file = arg('switches', path.join(dir, 'licensed-switches.json'));
let sw = DEFAULT_LICENSED;
try {
  sw = parseSwitches(JSON.parse(fs.readFileSync(file, 'utf8')));
} catch {
  console.log('No switches file; keeping defaults.');
}
if (Object.values(sw).every(Boolean)) {
  console.log('All licensed switches on; nothing to apply.');
  process.exit(0);
}
let removed = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^shows-.+\.json$/.test(n))) {
  const p = path.join(dir, f);
  const feed = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = feed.shows.length;
  feed.shows = applySwitchesToAll(feed.shows, sw);
  removed += before - feed.shows.length;
  fs.writeFileSync(p, JSON.stringify(feed));
}
console.log(`Switches applied (${JSON.stringify(sw)}); ${removed} shows removed.`);
