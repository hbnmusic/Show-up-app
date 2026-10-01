export type VenueType = 'basement' | 'house' | 'diy' | 'venue';
export type AddressVisibility = 'public' | 'neighborhood_only' | 'on_request';
export type AgePolicy = 'all_ages' | '18_plus' | '21_plus' | 'unknown';
export type ShowStatus = 'scheduled' | 'cancelled' | 'moved';

export type Genre =
  | 'Punk'
  | 'Hardcore'
  | 'Screamo'
  | 'Emo'
  | 'Post-Punk'
  | 'Darkwave'
  | 'Industrial'
  | 'Garage'
  | 'Indie Rock'
  | 'Shoegaze'
  | 'Noise Rock'
  | 'Metal'
  | 'Sludge & Doom'
  | 'Psych'
  | 'Folk'
  | 'Pop'
  | 'Experimental'
  | 'Jazz & Improv'
  | 'Club & Techno'
  | 'Soul & Gospel';

export type Venue = {
  name: string;
  type: VenueType;
  neighborhood: string;
  /** Borough or town, shown in listings. */
  area: string;
  /** Which feed city this venue belongs to (see metros.ts). Missing in older feeds, which were NYC only. */
  metro: string;
  lat?: number;
  lng?: number;
  /** City/state line used for calendar locations, e.g. "Brooklyn, NY". */
  city: string;
  address?: string;
  addressVisibility: AddressVisibility;
};

export type Act = {
  name: string;
  /** 0 = headliner. */
  order: number;
  links?: {
    soundcloud?: string;
    bandcamp?: string;
    deezerArtistId?: number;
  };
};

export type Price = {
  min?: number;
  max?: number;
  isFree?: boolean;
  /** "No one turned away for lack of funds" — sliding scale. */
  notaflof?: boolean;
};

export type Show = {
  id: string;
  /** Event title when the listing is a named night rather than a plain bill. */
  title?: string;
  startsAt: string;
  doorsAt?: string;
  endsAt?: string;
  /** Listing gave a date but no time. */
  timeTba?: boolean;
  venue: Venue;
  acts: Act[];
  genres: Genre[];
  price: Price;
  agePolicy: AgePolicy;
  flyerImages?: string[];
  ticketUrl?: string;
  status: ShowStatus;
  source: { provider: string; url: string; fetchedAt: string };
  updatedAt: string;
};

export type Decision = 'going' | 'passed';

export type WhenFilter = 'tonight' | 'tomorrow' | 'weekend' | 'week' | 'month' | 'all';
export type PriceFilter = 'any' | 'free' | 'under10' | 'under20';
export type AgeFilter = 'any' | 'all_ages' | '18_plus';

/** The place the deck is centered on: the phone's location or a chosen city. */
export type Place = { label: string; lat: number; lng: number; metro?: string; source: 'device' | 'city' };

export type Filters = {
  when: WhenFilter;
  /** null = no location limit (shows everything in the feed). */
  place: Place | null;
  radiusMi: number;
  venueTypes: VenueType[];
  genres: Genre[];
  price: PriceFilter;
  age: AgeFilter;
};

export const DEFAULT_FILTERS: Filters = {
  when: 'week',
  place: null,
  radiusMi: 25,
  venueTypes: [],
  genres: [],
  price: 'any',
  age: 'any',
};

export type ReminderPrefs = {
  dayOf: boolean;
  beforeDoors: boolean;
  dayBefore: boolean;
};

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  dayOf: true,
  beforeDoors: true,
  dayBefore: false,
};

export const RADIUS_OPTIONS = [5, 10, 15, 25] as const;

export const ALL_GENRES: readonly Genre[] = [
  'Punk', 'Hardcore', 'Screamo', 'Emo', 'Post-Punk', 'Darkwave', 'Industrial', 'Garage', 'Indie Rock',
  'Shoegaze', 'Noise Rock', 'Metal', 'Sludge & Doom', 'Psych', 'Folk', 'Pop', 'Experimental',
  'Jazz & Improv', 'Club & Techno', 'Soul & Gospel',
];
