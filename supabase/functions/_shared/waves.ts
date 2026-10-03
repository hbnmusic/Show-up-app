/** Which metros are scanned, when the next wave opens, and which venues are due today. */
import type { VenueTier } from './types.ts';

export type MetroSetting = { id: string; wave: 1 | 2 | 3; venueScanEnabled: boolean; dailyRequestBudget: number; lastFullScanAt?: string | null };

/** Wave 1 = metros flagged hot; wave 2 = the next largest by show volume in our feeds; wave 3 = the rest. */
export function assignWaves(metros: readonly { id: string; hot: boolean }[], showVolume: Readonly<Record<string, number>>, wave2Size = 12): Record<string, 1 | 2 | 3> {
  const out: Record<string, 1 | 2 | 3> = {};
  const rest = metros.filter((m) => !m.hot).sort((a, b) => (showVolume[b.id] ?? 0) - (showVolume[a.id] ?? 0) || a.id.localeCompare(b.id));
  for (const m of metros) if (m.hot) out[m.id] = 1;
  rest.forEach((m, i) => (out[m.id] = i < wave2Size ? 2 : 3));
  return out;
}

export type WidenInput = {
  /** Highest wave currently scanning. */
  currentWave: 1 | 2 | 3;
  settings: readonly MetroSetting[];
  now: Date;
  refreshDays: number;
  /** Share of the daily cap used on each of the last days, newest first. Needs 7 to decide. */
  dailyUsageShare: readonly number[];
  headroom: number;
  /** Metros an operator switched off by hand; they do not hold back widening. */
  offFlags?: ReadonlySet<string>;
};

export type WidenDecision = { widen: boolean; nextWave?: 2 | 3; reasons: string[] };

export function decideWidening(i: WidenInput): WidenDecision {
  if (i.currentWave === 3) return { widen: false, reasons: ['all waves already scanning'] };
  const reasons: string[] = [];
  const horizon = i.now.getTime() - i.refreshDays * 86400_000;
  const prev = i.settings.filter((s) => s.wave <= i.currentWave && s.venueScanEnabled && !i.offFlags?.has(s.id));
  const stale = prev.filter((s) => !s.lastFullScanAt || Date.parse(s.lastFullScanAt) < horizon);
  if (prev.length === 0) reasons.push('no metros in current waves');
  if (stale.length) reasons.push(`${stale.length} metro(s) not fully scanned within ${i.refreshDays} days: ${stale.slice(0, 5).map((s) => s.id).join(', ')}`);
  const week = i.dailyUsageShare.slice(0, 7);
  if (week.length < 7) reasons.push(`only ${week.length} of 7 days of usage recorded`);
  else if (week.some((u) => u >= i.headroom)) reasons.push(`quota use reached ${Math.round(Math.max(...week) * 100)}% on at least one of the last 7 days (headroom ${Math.round(i.headroom * 100)}%)`);
  if (reasons.length) return { widen: false, reasons };
  return { widen: true, nextWave: (i.currentWave + 1) as 2 | 3, reasons: ['previous waves fully scanned and quota use stayed under headroom for 7 days'] };
}

export type ScanVenue = { id: string; metro: string; tier: VenueTier; lastCheckedAt?: string | null; status: string; needsAi?: boolean };
export type ScanPlan = { venues: ScanVenue[]; aiUsed: Record<string, number>; skippedForBudget: number };

/**
 * Venues due now, most overdue first. Structured venues (tier A) cost no model requests. Pages that need the
 * model count against their metro's daily request budget; the rest wait for the next day.
 */
export function planScan(venues: readonly ScanVenue[], settings: readonly MetroSetting[], now: Date, refreshDays: number): ScanPlan {
  const byMetro = new Map(settings.map((s) => [s.id, s]));
  const due = venues
    .filter((v) => v.status === 'approved' && byMetro.get(v.metro)?.venueScanEnabled)
    .filter((v) => !v.lastCheckedAt || now.getTime() - Date.parse(v.lastCheckedAt) >= refreshDays * 86400_000 * 0.9)
    .sort((a, b) => Date.parse(a.lastCheckedAt ?? '1970-01-01') - Date.parse(b.lastCheckedAt ?? '1970-01-01'));
  const plan: ScanVenue[] = [];
  const aiUsed: Record<string, number> = {};
  let skipped = 0;
  for (const v of due) {
    const ai = v.tier === 'B' || v.needsAi === true;
    if (ai) {
      const budget = byMetro.get(v.metro)!.dailyRequestBudget;
      if ((aiUsed[v.metro] ?? 0) >= budget) { skipped++; continue; }
      aiUsed[v.metro] = (aiUsed[v.metro] ?? 0) + 1;
    }
    plan.push(v);
  }
  return { venues: plan, aiUsed, skippedForBudget: skipped };
}
