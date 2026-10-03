/** Automatic approval of candidate venues, automatic disabling of unhealthy ones, and wave planning. No manual review step. */
import type { RobotsStatus, VenueTier } from './types.ts';

/** Hosts that are never a venue's own site: social networks, aggregators and ticket sellers we do not read. */
const NOT_OWN_DOMAIN = [
  'instagram.com', 'facebook.com', 'fb.com', 'threads.net', 'tiktok.com', 'twitter.com', 'x.com', 'linktr.ee', 'youtube.com',
  'songkick.com', 'bandsintown.com', 'ra.co', 'residentadvisor.net', 'dice.fm', 'eventbrite.com', 'eventbrite.ca', 'ticketmaster.com',
  'ticketmaster.ca', 'livenation.com', 'axs.com', 'seatgeek.com', 'jambase.com', 'stubhub.com', 'vividseats.com', 'ticketweb.com', 'etix.com', 'yelp.com', 'tripadvisor.com',
];

export function isOwnDomain(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return !NOT_OWN_DOMAIN.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export type VenueChecks = {
  website: string | undefined;
  robots: RobotsStatus;
  /** The venue's name was found on its own page. */
  nameMatches: boolean;
  /** Address geocodes inside the metro: true, false, or null when it could not be checked. */
  insideMetro: boolean | null;
  /** Events found by a structured tier (JSON-LD, iCal, RSS, widget) in the trial. */
  structuredEvents: number;
  /** Valid future events from the model trial, each with a quoted source. */
  aiEventsWithEvidence: number;
  venueTypeOk: boolean;
};

export type Approval = { decision: 'approved' | 'rejected' | 'quarantined'; tier: VenueTier | null; reasons: string[] };

export function evaluateVenue(c: VenueChecks): Approval {
  const reject: string[] = [];
  if (!isOwnDomain(c.website)) reject.push('not_own_domain');
  if (c.robots === 'disallowed') reject.push('robots_disallow');
  if (c.robots === 'bot_wall') reject.push('bot_wall');
  if (!c.nameMatches) reject.push('name_mismatch');
  if (c.insideMetro === false) reject.push('outside_metro');
  if (!c.venueTypeOk) reject.push('venue_type');
  if (reject.length) return { decision: 'rejected', tier: null, reasons: reject };
  if (c.insideMetro === null) return { decision: 'quarantined', tier: 'C', reasons: ['address_unverified'] };
  if (c.robots === 'unknown') return { decision: 'quarantined', tier: 'C', reasons: ['robots_unreadable'] };
  if (c.structuredEvents > 0) return { decision: 'approved', tier: 'A', reasons: [] };
  if (c.aiEventsWithEvidence > 0) return { decision: 'approved', tier: 'B', reasons: [] };
  return { decision: 'quarantined', tier: 'C', reasons: ['no_valid_events_in_trial'] };
}

export type RunHealth = { fetchOk: boolean; extracted: number; rejected: number };

export type DisableInput = { recent: RunHealth[]; robots: RobotsStatus; takedown: boolean };

/** `recent` is newest first. Returns the reason to disable, or null to keep scanning. */
export function shouldDisable(i: DisableInput): string | null {
  if (i.takedown) return 'takedown';
  if (i.robots === 'disallowed') return 'robots_disallow';
  if (i.robots === 'bot_wall') return 'bot_wall';
  const last3 = i.recent.slice(0, 3);
  if (last3.length === 3 && last3.every((r) => !r.fetchOk)) return 'fetch_errors';
  const last5 = i.recent.slice(0, 5).filter((r) => r.fetchOk);
  const extracted = last5.reduce((n, r) => n + r.extracted, 0);
  const rejected = last5.reduce((n, r) => n + r.rejected, 0);
  if (i.recent.slice(0, 5).length === 5 && extracted >= 5 && rejected / extracted >= 0.4) return 'validator_rejections';
  return null;
}
