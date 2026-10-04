/**
 * Rewrites the published feed files through the app's own validation, which drops anything that must not ship:
 * photos, prices, links and credit lines left over from the removed ticket-seller enrichment (see
 * src/lib/listings/validate.ts and src/lib/imageGuard.ts). Runs on every refresh before publishing, so older files are
 * cleaned once and never come back. Prints how many shows changed.
 *
 *   npx tsx scripts/clean-feeds.ts --dir listings
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { parseFeed } from '../src/lib/listings/validate';
import { arg } from './lib/api';

const dir = arg('dir', 'listings');
let files = 0;
let changed = 0;
let dropped = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^shows-.+\.json$/.test(n))) {
  const p = path.join(dir, f);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const parsed = parseFeed(raw);
  if (!parsed) continue;
  const before = new Map<string, Record<string, unknown>>((raw.shows as { id: string }[]).map((s) => [s.id, s as Record<string, unknown>]));
  const shows = parsed.feed.shows;
  for (const s of shows) {
    const was = before.get(s.id);
    if (!was) continue;
    const key = (o: Record<string, unknown>) => JSON.stringify([o.flyerImages ?? null, o.flyerCredit ?? null, o.ticketUrl ?? null, Object.values((o.price as object) ?? {}).length, o.fieldSources ?? null]);
    if (key(was) !== key(s as unknown as Record<string, unknown>)) changed++;
  }
  dropped += parsed.dropped;
  fs.writeFileSync(p, JSON.stringify({ ...raw, attribution: parsed.feed.attribution, shows }));
  files++;
}
console.log(`Cleaned ${files} feed files; ${changed} shows changed, ${dropped} dropped as invalid.`);
