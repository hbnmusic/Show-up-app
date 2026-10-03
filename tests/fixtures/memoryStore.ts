import type { MergedShow } from '../../supabase/functions/_shared/match.ts';
import type { ShowVisibility, Store, StoredRecord } from '../../supabase/functions/_shared/pipeline.ts';
import type { LlmUsage } from '../../supabase/functions/_shared/provider.ts';
import { DEFAULT_QUOTA, type QuotaConfig, type Usage } from '../../supabase/functions/_shared/quota.ts';
import type { Candidate, MetroRow, VenueRow } from '../../supabase/functions/_shared/types.ts';

export type MemShow = { id: string; merged: MergedShow; visibility: ShowVisibility; submitter: string | null; confidence?: number; corroborated: boolean; unconfirmed: boolean };

export class MemoryStore implements Store {
  shows = new Map<string, MemShow>();
  records: (StoredRecord & { at: number })[] = [];
  usageByDay = new Map<string, { flyer: number; venue: number; throttled: number; tokens: number }>();
  banned = new Set<string>();
  trusted = new Set<string>();
  blockedKeys = new Set<string>();
  cfg: QuotaConfig & { model: string } = { ...DEFAULT_QUOTA, model: 'test-model' };
  private n = 0;

  constructor(public metroRows: MetroRow[], public venueRows: VenueRow[]) {}

  async quotaConfig() { return this.cfg; }
  async usage(day: string): Promise<Usage> { const u = this.usageByDay.get(day); return { flyer: u?.flyer ?? 0, venue: u?.venue ?? 0 }; }
  async addUsage(day: string, kind: 'flyer' | 'venue', d: { requests?: number; throttled?: number; usage?: LlmUsage }) {
    const u = this.usageByDay.get(day) ?? { flyer: 0, venue: 0, throttled: 0, tokens: 0 };
    u[kind] += d.requests ?? 0;
    u.throttled += d.throttled ?? 0;
    u.tokens += (d.usage?.inputTokens ?? 0) + (d.usage?.outputTokens ?? 0);
    this.usageByDay.set(day, u);
  }
  async metros() { return this.metroRows; }
  async registry() { return this.venueRows; }
  async isBanned(uid: string | null) { return !!uid && this.banned.has(uid); }
  async isTrusted(uid: string | null) { return !!uid && this.trusted.has(uid); }
  async isBlockedKey(key: string) { return this.blockedKeys.has(key); }
  async recordsNear(metro: string, nights: string[]) {
    return this.records
      .filter((r) => r.candidate.metro === metro && nights.includes(r.candidate.localDate))
      .map((r) => ({ ...r, visibility: this.shows.get(r.showId)!.visibility }));
  }
  async markUnconfirmed(venueId: string, seenKeys: string[], today: string) {
    let n = 0;
    for (const s of this.shows.values()) {
      if (s.merged.venueId !== venueId || !s.merged.sources.some((x) => x.sourceType === 'venue_site') || s.merged.localDate < today) continue;
      const missing = !seenKeys.includes(s.merged.key);
      if (missing) n++;
      s.unconfirmed = missing;
    }
    return n;
  }
  async saveShow(m: MergedShow, o: { showId?: string; visibility: ShowVisibility; submitter: string | null; confidence?: number; corroborated: boolean }, record: Candidate) {
    const id = o.showId ?? `show-${++this.n}`;
    const prev = this.shows.get(id);
    this.shows.set(id, { id, merged: m, visibility: o.visibility, submitter: o.submitter ?? prev?.submitter ?? null, confidence: o.confidence, corroborated: o.corroborated, unconfirmed: false });
    this.records.push({ showId: id, candidate: record, submitter: record.sourceType === 'flyer' ? o.submitter : null, at: this.records.length });
    return id;
  }
}
