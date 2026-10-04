/**
 * Scheduled venue scan. Asks the fp-job function what is due, trials candidate venues, reads approved venues,
 * then runs daily maintenance (wave decision) and, with --weekly, the plain-language summary.
 *
 *   FP_JOB_URL=... JOB_TOKEN=... npx tsx scripts/venue-scan.ts [--max-venues 150] [--max-trials 40] [--weekly] [--maintenance-only]
 *
 * Polite by construction (see scripts/lib/polite.ts): bot user agent, robots.txt, per-host spacing, conditional
 * requests; blocked pages are skipped and logged, never worked around.
 */
/// <reference types="node" />
import { arg, flag, makeApi } from './lib/api';
import { metroById } from '../src/lib/metros';
import { makeGeocoder, withCoordinates } from './lib/geo';
import { PoliteFetcher } from './lib/polite';
import { paceAi } from './lib/scan';
import { runVenueScan } from './lib/scanRun';

async function main() {
  const api = paceAi(makeApi());
  const geocode = withCoordinates(makeGeocoder(), (id) => metroById(id));
  const r = await runVenueScan({
    api,
    fetcher: new PoliteFetcher(),
    geocode,
    maxVenues: Number(arg('max-venues', '150')),
    maxTrials: Number(arg('max-trials', '40')),
    deadline: Date.now() + Number(arg('max-minutes', '40')) * 60_000,
    weekly: flag('weekly'),
    maintenanceOnly: flag('maintenance-only'),
    log: (line) => console.log(line),
  });
  console.log(r.skipped ? `Exited cleanly: ${r.skipped}.` : `Totals: ${JSON.stringify(r.tally)}`);
}

main().catch((e) => {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Venue scan failed::${String(e.message).replace(/\r?\n/g, ' ')}` : e);
  process.exit(1);
});
