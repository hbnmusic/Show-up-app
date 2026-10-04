import type { AppGenre } from './genres.ts';
import type { ParsedPrice } from './dates.ts';

export type SourceType = 'flyer' | 'venue_site' | 'jambase';
export type LicenceClass = 'first_party' | 'jambase' | 'deezer';

export const licenceFor = (t: SourceType): LicenceClass => (t === 'jambase' ? 'jambase' : 'first_party');

export type ShowStatus = 'scheduled' | 'cancelled' | 'moved';

/** One source's record of one show, normalised. Records are kept per source and never overwritten. */
export type Candidate = {
  sourceType: SourceType;
  licence: LicenceClass;
  sourceUrl?: string;
  fetchedAt: string;
  metro: string | null;
  venueId: string | null;
  venueName: string;
  /** City or neighbourhood as printed; shown when the venue is not in the registry. */
  city?: string;
  /** Local date at the venue, YYYY-MM-DD. */
  localDate: string;
  startLocal?: string;
  doorsLocal?: string;
  headliner: string;
  supports: string[];
  title?: string;
  price?: ParsedPrice;
  ticketUrl?: string;
  status?: ShowStatus;
  genres: AppGenre[];
  agePolicy?: string;
  /** Street address, only ever copied from the venue registry, never from a flyer. */
  address?: string;
  addressMode: 'registry' | 'withheld';
  imageUrl?: string;
  /** Flyers only: lowest confidence among headliner, venue and date, 0..1. */
  confidence?: number;
  inferredYear?: boolean;
  /** Short quotes the fields came from, for review. */
  evidence?: Record<string, string>;
};

export type VenueTier = 'A' | 'B' | 'C';
export type RobotsStatus = 'ok' | 'disallowed' | 'bot_wall' | 'unknown';

export type VenueRow = {
  id: string;
  name: string;
  aliases: string[];
  metro: string;
  address?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  website?: string;
  eventsUrl?: string;
  publishMethod?: 'jsonld' | 'ical' | 'rss' | 'widget' | 'ai' | 'none';
  robots?: RobotsStatus;
  tier?: VenueTier;
  status?: 'candidate' | 'approved' | 'rejected' | 'quarantined' | 'disabled';
};

export type MetroRow = { id: string; name: string; state: string; tz: string; aliases?: string[] };
