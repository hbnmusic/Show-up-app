export type AddressVisibility = 'public' | 'neighborhood_only' | 'on_request';
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
  | 'Electronic'
  | 'Soul & Gospel'
  | 'Rock'
  | 'Country'
  | 'Blues'
  | 'Hip-Hop'
  | 'Classical'
  | 'Latin'
  | 'Reggae';

export type Venue = {
  name: string;
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
  flyerImages?: string[];
  /** Who to credit when flyerImages came from a provider rather than the promoter. */
  flyerCredit?: string;
  ticketUrl?: string;
  /** Fields filled in from Ticketmaster, so the licensed layer can be switched off or purged by field. Absent on older feeds. */
  fieldSources?: { price?: 'ticketmaster'; image?: 'ticketmaster'; ticketUrl?: 'ticketmaster' };
  /** Set on cards that include first-party data (venue pages or shared flyers): where each part came from. See fpMerge.ts. */
  provenance?: import('./fpMerge').Provenance;
  status: ShowStatus;
  source: { provider: string; url: string; fetchedAt: string; /** Community shows only: the person who added it (an opaque id), used for block and report. */ author?: string };
  updatedAt: string;
};

export type Decision = 'going' | 'passed';

export type WhenFilter = 'tonight' | 'tomorrow' | 'weekend' | 'week' | 'month' | 'all';
export type PriceFilter = 'any' | 'free' | 'under10' | 'under20';

/** The place the deck is centered on: the phone's location or a chosen city. */
export type Place = { label: string; lat: number; lng: number; metro?: string; source: 'device' | 'city' };

export type Filters = {
  when: WhenFilter;
  /** null = no location limit (shows everything in the feed). */
  place: Place | null;
  radiusMi: number;
  genres: Genre[];
  price: PriceFilter;
};

export const DEFAULT_FILTERS: Filters = {
  when: 'week',
  place: null,
  radiusMi: 25,
  genres: [],
  price: 'any',
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

/** Genres shown together in pickers. Genre ids never change; only this grouping is for display. */
export const GENRE_GROUPS: readonly { title: string; genres: readonly Genre[] }[] = [
  { title: 'Rock & Indie', genres: ['Rock', 'Indie Rock', 'Garage', 'Psych', 'Shoegaze', 'Noise Rock'] },
  { title: 'Punk & Hardcore', genres: ['Punk', 'Hardcore', 'Screamo', 'Emo', 'Post-Punk'] },
  { title: 'Metal & Heavy', genres: ['Metal', 'Sludge & Doom'] },
  { title: 'Electronic & Dark', genres: ['Electronic', 'Darkwave', 'Industrial'] },
  { title: 'Folk & Roots', genres: ['Folk', 'Country', 'Blues'] },
  { title: 'Pop, Hip-Hop & Soul', genres: ['Pop', 'Hip-Hop', 'Soul & Gospel'] },
  { title: 'Jazz, Classical & Experimental', genres: ['Jazz & Improv', 'Classical', 'Experimental'] },
  { title: 'Latin & Reggae', genres: ['Latin', 'Reggae'] },
];

export const ALL_GENRES: readonly Genre[] = GENRE_GROUPS.flatMap((g) => g.genres);

/** Groups with only the genres kept by `keep`; empty groups are dropped. */
export function groupGenres(keep: (g: Genre) => boolean): { title: string; genres: Genre[] }[] {
  return GENRE_GROUPS.map((g) => ({ title: g.title, genres: g.genres.filter(keep) })).filter((g) => g.genres.length > 0);
}
