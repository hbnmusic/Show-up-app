/**
 * Soft-launch readiness numbers for one city, from what a phone would see: the JamBase feed, first-party shows and
 * community shows, merged the way the app merges them. Pure, so it is tested; scripts/readiness-report.ts loads the data.
 */
import { mergeFirstParty, type FpRow } from '../../src/lib/fpMerge';
import { inWhen, isUpcoming } from '../../src/lib/filters';
import { dedupeKey } from '../../src/lib/listings/merge';
import { DEFAULT_PLAN } from '../../src/lib/retention/planner';
import type { Show } from '../../src/lib/types';

export type VenueCounts = { approvedA: number; approvedB: number; quarantined: number; rejected: number; disabled: number; scannedInWindow: number; venuesTotal: number };

export type ReadinessInput = {
  metro: { id: string; name: string };
  now: Date;
  /** Shows from the published JamBase feed for this city. */
  jambase: Show[];
  fpRows: FpRow[];
  community: Show[];
  venues: VenueCounts | null;
  rejections: { reason: string; count: number }[];
  /** Show ids in an earlier download of the feed (to count what was added since). Optional. */
  previousIds?: ReadonlySet<string> | null;
  previousAt?: string | null;
};

export type Readiness = {
  metro: string;
  name: string;
  total: number;
  next7: number;
  next30: number;
  /** Over the next 30 days. A show both sources have counts once, under "firstParty" with `alsoInJamBase` noting the overlap. */
  share: { jambaseOnly: number; firstParty: number; firstPartyAlsoInJamBase: number; community: number };
  venues: VenueCounts | null;
  topRejections: { reason: string; count: number }[];
  genresTonight: Record<string, number>;
  genresWeek: Record<string, number>;
  untaggedTonight: number;
  untaggedWeek: number;
  tonight: number;
  notifications: {
    typeB: { min: number; tonight: number; met: boolean; genresMeetingMinimum: string[] };
    typeA: { min: number; newSincePrevious: number | null; previousAt: string | null; met: boolean | null; note: string };
  };
};

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/** What the app shows for this city: JamBase shows with first-party data merged in, plus community shows that are not duplicates. */
export function combineForCity(i: Pick<ReadinessInput, 'metro' | 'jambase' | 'fpRows' | 'community'>): Show[] {
  const merged = i.fpRows.length ? mergeFirstParty(i.jambase, i.fpRows, i.metro.id) : i.jambase;
  const taken = new Set(merged.map(dedupeKey));
  const out = [...merged];
  for (const s of i.community) {
    const k = dedupeKey(s);
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(s);
  }
  return out;
}

export function buildReadiness(i: ReadinessInput): Readiness {
  const all = combineForCity(i).filter((s) => isUpcoming(s, i.now));
  const w7 = all.filter((s) => inWhen(s, 'week', i.now));
  const w30 = all.filter((s) => inWhen(s, 'month', i.now));
  const tonight = all.filter((s) => inWhen(s, 'tonight', i.now));

  const share = { jambaseOnly: 0, firstParty: 0, firstPartyAlsoInJamBase: 0, community: 0 };
  for (const s of w30) {
    const fp = s.id.startsWith('fp:') || !!s.provenance?.fpId;
    if (fp) {
      share.firstParty++;
      if (s.source.provider === 'jambase') share.firstPartyAlsoInJamBase++;
    } else if (s.source.provider === 'community') share.community++;
    else share.jambaseOnly++;
  }

  const genres = (list: Show[]) => {
    const out: Record<string, number> = {};
    for (const s of list) for (const g of new Set(s.genres)) bump(out, g);
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  const genresTonight = genres(tonight);
  const genresWeek = genres(w7);

  const min = DEFAULT_PLAN;
  const newSince = i.previousIds ? all.filter((s) => !i.previousIds!.has(s.id)).length : null;
  return {
    metro: i.metro.id,
    name: i.metro.name,
    total: all.length,
    next7: w7.length,
    next30: w30.length,
    share,
    venues: i.venues,
    topRejections: i.rejections.slice(0, 5),
    genresTonight,
    genresWeek,
    untaggedTonight: tonight.filter((s) => s.genres.length === 0).length,
    untaggedWeek: w7.filter((s) => s.genres.length === 0).length,
    tonight: tonight.length,
    notifications: {
      typeB: {
        min: min.minB,
        tonight: tonight.length,
        met: tonight.length >= min.minB,
        genresMeetingMinimum: Object.entries(genresTonight).filter(([, n]) => n >= min.minB).map(([g]) => g),
      },
      typeA: {
        min: min.minA,
        newSincePrevious: newSince,
        previousAt: i.previousAt ?? null,
        met: newSince == null ? null : newSince >= min.minA,
        note:
          newSince == null
            ? 'Needs two downloads to measure: a phone compares what it has now with what it saw last time.'
            : 'Shows in this download that were not in the earlier one (a phone compares against its own last look, so its number differs).',
      },
    },
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%');
const genreLine = (g: Record<string, number>) => Object.entries(g).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

export function renderReadiness(rs: Readiness[], at: Date): string {
  const lines = [`Soft-launch readiness, ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
  for (const r of rs) {
    lines.push(`${r.name} (${r.metro})`);
    lines.push(`  Upcoming shows: ${r.next7} in the next 7 days, ${r.next30} in the next 30 days (${r.total} in all)`);
    const d = r.next30;
    lines.push(`  Source share, next 30 days: JamBase only ${r.share.jambaseOnly} (${pct(r.share.jambaseOnly, d)}), first-party ${r.share.firstParty} (${pct(r.share.firstParty, d)}; ${r.share.firstPartyAlsoInJamBase} of them are also in JamBase), community ${r.share.community} (${pct(r.share.community, d)})`);
    if (r.venues) {
      const v = r.venues;
      lines.push(`  Venues: ${v.approvedA + v.approvedB} approved (${v.approvedA} structured, ${v.approvedB} read by the model), ${v.scannedInWindow} read in the last window, ${v.quarantined} quarantined, ${v.rejected} rejected, ${v.disabled} disabled`);
    } else lines.push('  Venues: not available (the venue database was not reachable)');
    lines.push(`  Top rejection reasons: ${r.topRejections.length ? r.topRejections.map((x) => `${x.reason} ${x.count}`).join(', ') : 'none recorded'}`);
    lines.push(`  Tonight: ${r.tonight} shows. By genre: ${genreLine(r.genresTonight)}${r.untaggedTonight ? `; ${r.untaggedTonight} untagged` : ''}`);
    lines.push(`  This week: ${r.next7} shows. By genre: ${genreLine(r.genresWeek)}${r.untaggedWeek ? `; ${r.untaggedWeek} untagged` : ''}`);
    const b = r.notifications.typeB;
    lines.push(`  "Shows tonight" notification (needs ${b.min}): ${b.met ? 'minimum met' : 'minimum NOT met'} with ${b.tonight} tonight${b.genresMeetingMinimum.length ? `; genres with ${b.min}+ tonight: ${b.genresMeetingMinimum.join(', ')}` : ''}`);
    const a = r.notifications.typeA;
    lines.push(`  "New shows" notification (needs ${a.min}): ${a.met == null ? 'not measurable from one download' : `${a.met ? 'minimum met' : 'minimum NOT met'} with ${a.newSincePrevious} added since ${a.previousAt ?? 'the earlier download'}`}. ${a.note}`);
    lines.push('');
  }
  return lines.join('\n');
}
