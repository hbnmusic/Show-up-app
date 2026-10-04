/**
 * Applies the kill switches and the licensed-layer switches to the published feed files, so switched-off data never ships.
 *
 *   npx tsx scripts/apply-switches.ts --dir listings            rebuilds the feeds (JamBase records and credit removed when it is off)
 *   npx tsx scripts/apply-switches.ts --dir listings --gate     only prints jambase=true|false (and writes it to $GITHUB_OUTPUT), changes nothing
 *
 * Inputs (all optional; a missing file means defaults, everything on): listings/flags.json (public RPC get_flags) and
 * listings/licensed-switches.json (public RPC fp_licensed_switches).
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_LICENSED, jambaseOn, parseSwitches, rebuildFeed } from '../src/lib/licensed';
import { parseFlags } from '../src/lib/flagsCore';
import { arg, flag } from './lib/api';

const dir = arg('dir', 'listings');
const read = (name: string) => {
  try {
    return JSON.parse(fs.readFileSync(arg(name.replace('.json', ''), path.join(dir, name)), 'utf8'));
  } catch {
    return null;
  }
};
const sw = read('licensed-switches.json') ? parseSwitches(read('licensed-switches.json')) : DEFAULT_LICENSED;
const flags = parseFlags(read('flags.json'));
const on = jambaseOn(sw, flags);

if (flag('gate')) {
  console.log(`jambase=${on}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `jambase=${on}\n`);
  process.exit(0);
}
if (on) {
  console.log('JamBase is on; nothing to apply.');
  process.exit(0);
}
let removed = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^shows-.+\.json$/.test(n))) {
  const p = path.join(dir, f);
  const r = rebuildFeed(JSON.parse(fs.readFileSync(p, 'utf8')), false);
  removed += r.removed;
  fs.writeFileSync(p, JSON.stringify(r.feed));
}
console.log(`JamBase is switched off; feeds rebuilt without it (${removed} records removed).`);
