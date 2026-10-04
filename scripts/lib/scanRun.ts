/** One scheduled venue-scan run, written so tests can drive it with a fake API. Honours the venue_scan and AI kill switches. */
import { isOn, parseFlags, type Flags } from '../../src/lib/flagsCore';
import { scanVenue, trialVenue, type Api, type Geocode, type PlanVenue } from './scan';
import type { PoliteFetcher } from './polite';

export type RunOptions = {
  api: Api;
  fetcher: PoliteFetcher;
  geocode: Geocode;
  maxVenues: number;
  maxTrials: number;
  /** Epoch ms after which no new venue is started. */
  deadline: number;
  weekly?: boolean;
  maintenanceOnly?: boolean;
  /** Flags are read again after this many venues, so a switch takes effect within minutes. */
  flagEvery?: number;
  now?: () => number;
  log?: (line: string) => void;
};

export type RunResult = { skipped?: 'venue_scan_off'; stoppedByFlag?: boolean; tally: Record<string, number> };

export async function readApiFlags(api: Api): Promise<Flags> {
  try {
    const r = await api('flags');
    return parseFlags(r.flags);
  } catch {
    return parseFlags(null); // unreachable: keep the defaults rather than stop the job
  }
}

export async function runVenueScan(o: RunOptions): Promise<RunResult> {
  const { api, fetcher, geocode } = o;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const flagEvery = o.flagEvery ?? 10;
  const tally: Record<string, number> = {};
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);

  let flags = await readApiFlags(api);
  if (!isOn(flags, 'venue_scan_enabled')) {
    log('Venue scanning is switched off (venue_scan_enabled). Nothing to do.');
    return { skipped: 'venue_scan_off', tally };
  }
  if (!isOn(flags, 'ai_extraction_enabled')) log('AI reading is switched off (ai_extraction_enabled): only structured pages (JSON-LD, iCal, RSS, widgets) will be read.');

  let stoppedByFlag = false;
  let sinceCheck = 0;
  /** True when the scan should stop because the switch went off since the last look. */
  const checkFlags = async (): Promise<boolean> => {
    if (++sinceCheck < flagEvery) return false;
    sinceCheck = 0;
    flags = await readApiFlags(api);
    if (!isOn(flags, 'venue_scan_enabled')) {
      log('Venue scanning was switched off during the run; stopping.');
      stoppedByFlag = true;
      return true;
    }
    return false;
  };

  if (!o.maintenanceOnly) {
    const plan = await api('plan');
    if (plan.paused) {
      log('The plan came back paused; nothing to do.');
      return { skipped: 'venue_scan_off', tally };
    }
    const scan = ((plan.scan ?? []) as PlanVenue[]).slice(0, o.maxVenues);
    const trial = ((plan.trial ?? []) as (PlanVenue & { tz?: string })[]).slice(0, o.maxTrials);
    log(`Plan: ${scan.length} venues to read, ${trial.length} candidates to try, ${plan.skippedForBudget ?? 0} skipped for budget.`);
    for (const v of trial) {
      if (now() > o.deadline) break;
      if (await checkFlags()) break;
      try {
        const r = await trialVenue(v, fetcher, api, geocode);
        bump(`trial_${r.decision}`);
        if (r.decision !== 'approved') log(`  trial ${v.name}: ${r.decision} (${r.reasons.join('; ')})`);
      } catch (e) {
        bump('trial_error');
        log(`  trial ${v.name}: error ${(e as Error).message}`);
      }
    }
    if (!stoppedByFlag) {
      for (const v of scan) {
        if (now() > o.deadline) { bump('stopped_for_time'); break; }
        if (await checkFlags()) break;
        try {
          const r = await scanVenue(v, fetcher, api);
          bump(`scan_${r.result}`);
          if (r.result === 'quota') { log('Model quota reached; leaving the rest for the next run.'); break; }
        } catch (e) {
          bump('scan_error');
          log(`  scan ${v.name}: error ${(e as Error).message}`);
        }
      }
    }
  }
  if (stoppedByFlag) return { stoppedByFlag, tally };
  const m = await api('maintenance');
  log(`Maintenance: ${JSON.stringify(m.reasons ?? m)}`);
  if (o.weekly) {
    const w = await api('coverage', { weekly: true });
    log(String(w.summary ?? ''));
  }
  return { tally };
}
