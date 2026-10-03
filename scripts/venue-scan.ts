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
import { makeGeocoder } from './lib/geo';
import { PoliteFetcher } from './lib/polite';
import { scanVenue, trialVenue, type PlanVenue } from './lib/scan';

async function main() {
  const api = makeApi();
  const maxVenues = Number(arg('max-venues', '150'));
  const maxTrials = Number(arg('max-trials', '40'));
  const fetcher = new PoliteFetcher();
  const tally: Record<string, number> = {};
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);

  if (!flag('maintenance-only')) {
    const plan = await api('plan');
    const scan = ((plan.scan ?? []) as PlanVenue[]).slice(0, maxVenues);
    const trial = ((plan.trial ?? []) as (PlanVenue & { tz?: string })[]).slice(0, maxTrials);
    console.log(`Plan: ${scan.length} venues to read, ${trial.length} candidates to try, ${plan.skippedForBudget ?? 0} skipped for budget.`);
    const geocode = makeGeocoder();
    const deadline = Date.now() + Number(arg('max-minutes', '40')) * 60_000;
    for (const v of trial) {
      if (Date.now() > deadline) break;
      try {
        const r = await trialVenue(v, fetcher, api, geocode);
        bump(`trial_${r.decision}`);
        if (r.decision !== 'approved') console.log(`  trial ${v.name}: ${r.decision} (${r.reasons.join('; ')})`);
      } catch (e) {
        bump('trial_error');
        console.log(`  trial ${v.name}: error ${(e as Error).message}`);
      }
    }
    for (const v of scan) {
      if (Date.now() > deadline) { bump('stopped_for_time'); break; }
      try {
        const r = await scanVenue(v, fetcher, api);
        bump(`scan_${r.result}`);
        if (r.result === 'quota') { console.log('Model quota reached; leaving the rest for the next run.'); break; }
      } catch (e) {
        bump('scan_error');
        console.log(`  scan ${v.name}: error ${(e as Error).message}`);
      }
    }
  }
  const m = await api('maintenance');
  console.log(`Maintenance: ${JSON.stringify(m.reasons ?? m)}`);
  if (flag('weekly')) {
    const w = await api('coverage', { weekly: true });
    console.log(String(w.summary ?? ''));
  }
  console.log('Totals:', JSON.stringify(tally));
}

main().catch((e) => {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Venue scan failed::${String(e.message).replace(/\r?\n/g, ' ')}` : e);
  process.exit(1);
});
