/**
 * Sample listings used only by the tests (not shipped in the app).
 *
 * Bills, venues, dates and times come from public listings fetched on
 * 2026-09-29 (NYC Noise, DoNYC venue pages, JamBase). Genre tags are the
 * app's own and are approximate. Flyer art is generated in the app; no
 * promoter artwork is republished.
 */
import type { AgePolicy, Genre, Price, Show, VenueType, AddressVisibility } from '@/lib/types';

type VenueDef = {
  name: string;
  type: VenueType;
  neighborhood: string;
  area: string;
  city: string;
  addressVisibility?: AddressVisibility;
  /** Age policy the venue listed on other nights; used when a listing gave none. */
  defaultAge?: AgePolicy;
  source: string;
};

const NYC_NOISE = 'https://www.nyc-noise.com/';
const donyc = (slug: string) => `https://donyc.com/venues/${slug}`;

const V = {
  saintVitus: { name: 'Saint Vitus', type: 'venue', neighborhood: 'Greenpoint', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: donyc('saint-vitus') },
  tvEye: { name: 'TV Eye', type: 'venue', neighborhood: 'Ridgewood', area: 'Queens', city: 'Queens, NY', defaultAge: '21_plus', source: donyc('tv-eye') },
  unionPool: { name: 'Union Pool', type: 'venue', neighborhood: 'Williamsburg', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: donyc('union-pool') },
  broadway: { name: 'The Broadway', type: 'venue', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: donyc('the-broadway') },
  purgatory: { name: 'Purgatory', type: 'venue', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: donyc('purgatory') },
  alphaville: { name: 'Alphaville', type: 'venue', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', source: donyc('alphaville') },
  transPecos: { name: 'Trans-Pecos', type: 'diy', neighborhood: 'Ridgewood', area: 'Queens', city: 'Queens, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  marketHotel: { name: 'Market Hotel', type: 'diy', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', source: donyc('market-hotel') },
  irvingPlaza: { name: 'Irving Plaza', type: 'venue', neighborhood: 'Union Square', area: 'Manhattan', city: 'New York, NY', source: 'https://donyc.com/events/music/2026/10/16' },
  pioneerWorks: { name: 'Pioneer Works', type: 'venue', neighborhood: 'Red Hook', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  roulette: { name: 'Roulette', type: 'venue', neighborhood: 'Downtown Brooklyn', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  lightSound: { name: 'Light & Sound Design', type: 'diy', neighborhood: 'Greenpoint', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  livingGallery: { name: 'The Living Gallery', type: 'diy', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  mamaTried: { name: 'Mama Tried', type: 'diy', neighborhood: 'Sunset Park', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  salonKingston: { name: 'Salon on Kingston', type: 'house', neighborhood: 'Bed-Stuy', area: 'Brooklyn', city: 'Brooklyn, NY', addressVisibility: 'neighborhood_only', defaultAge: 'all_ages', source: NYC_NOISE },
  stripedLight: { name: 'Striped Light', type: 'diy', neighborhood: 'Long Island City', area: 'Queens', city: 'Queens, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  veryFriendly: { name: 'Very Friendly Music', type: 'diy', neighborhood: 'Prospect Heights', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  kiSmith: { name: 'Ki Smith Gallery', type: 'diy', neighborhood: 'Lower East Side', area: 'Manhattan', city: 'New York, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  footlight: { name: 'Footlight at Windjammer', type: 'venue', neighborhood: 'Ridgewood', area: 'Queens', city: 'Queens, NY', defaultAge: '21_plus', source: NYC_NOISE },
  sleepwalk: { name: 'Sleepwalk', type: 'venue', neighborhood: 'Williamsburg', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: NYC_NOISE },
  hartBar: { name: 'Hart Bar', type: 'venue', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: NYC_NOISE },
  bossaNova: { name: 'Bossa Nova Civic Club', type: 'venue', neighborhood: 'Bushwick', area: 'Brooklyn', city: 'Brooklyn, NY', defaultAge: '21_plus', source: NYC_NOISE },
  hexHouse: { name: 'Hex House', type: 'house', neighborhood: 'Williamsburg', area: 'Brooklyn', city: 'Brooklyn, NY', addressVisibility: 'neighborhood_only', defaultAge: 'all_ages', source: NYC_NOISE },
  laundromat: { name: 'The Laundromat', type: 'diy', neighborhood: 'Maspeth', area: 'Queens', city: 'Queens, NY', defaultAge: 'all_ages', source: NYC_NOISE },
  whiteEagle: { name: 'White Eagle Hall', type: 'venue', neighborhood: 'Jersey City', area: 'North Jersey', city: 'Jersey City, NJ', source: donyc('white-eagle-hall') },
  montyHall: { name: 'WFMU Monty Hall', type: 'venue', neighborhood: 'Jersey City', area: 'North Jersey', city: 'Jersey City, NJ', source: donyc('monty-hall-wfmu') },
  williamsCenter: { name: 'Black Box at Williams Center', type: 'venue', neighborhood: 'Rutherford', area: 'North Jersey', city: 'Rutherford, NJ', source: 'https://www.jambase.com/concerts/us/new-jersey/genres/punk-concerts' },
  dingbatz: { name: 'Dingbatz', type: 'venue', neighborhood: 'Clifton', area: 'North Jersey', city: 'Clifton, NJ', source: 'https://www.jambase.com/concerts/us/new-jersey/genres/punk-concerts' },
} satisfies Record<string, VenueDef>;

type VenueKey = keyof typeof V;

/** New York is UTC-4 until Nov 1, 2026 and UTC-5 after. */
function nyIso(date: string, time: string): string {
  const offset = date >= '2026-11-01' ? '-05:00' : '-04:00';
  return `${date}T${time}:00${offset}`;
}

type Opts = {
  title?: string;
  price?: Price;
  age?: AgePolicy;
  timeTba?: boolean;
  endTime?: string;
  source?: string;
};

function show(
  date: string,
  time: string,
  venueKey: VenueKey,
  acts: string[],
  genres: Genre[],
  opts: Opts = {},
): Show {
  const v: VenueDef = V[venueKey];
  const slug = (opts.title ?? acts[0] ?? 'show')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 28);
  const id = `${date}-${venueKey}-${slug}`;
  const endsAt =
    opts.endTime && opts.endTime > time
      ? nyIso(date, opts.endTime)
      : undefined;
  return {
    id,
    title: opts.title,
    startsAt: nyIso(date, time),
    endsAt,
    timeTba: opts.timeTba,
    venue: {
      name: v.name,
      type: v.type,
      neighborhood: v.neighborhood,
      area: v.area,
      metro: 'nyc',
      city: v.city,
      addressVisibility: v.addressVisibility ?? 'public',
    },
    acts: acts.map((name, order) => ({ name, order })),
    genres,
    price: opts.price ?? {},
    agePolicy: opts.age ?? v.defaultAge ?? 'unknown',
    ticketUrl: opts.source ?? v.source,
    status: 'scheduled',
    source: { provider: 'sample', url: opts.source ?? v.source, fetchedAt: '2026-09-29' },
    updatedAt: '2026-09-29T12:00:00-04:00',
  };
}

const FREE: Price = { isFree: true, min: 0, max: 0 };
const SLIDING: Price = { notaflof: true };

export const SHOWS: Show[] = [
  // Thu Oct 1
  show('2026-10-01', '18:30', 'livingGallery', ['Sprint Wireless', 'MSHR', 'Ka Baird / Chris Cochrane / Mike Pride', 'Theatre of Divine Resonance'], ['Experimental']),
  show('2026-10-01', '19:00', 'unionPool', ['The Serfs', 'Cube', 'Content Blocks'], ['Post-Punk', 'Darkwave']),
  show('2026-10-01', '20:00', 'purgatory', ['Coco Smith', 'Heaviness Fell', 'Too Many Horses', 'The Moderators'], ['Indie Rock']),
  show('2026-10-01', '20:30', 'footlight', ['Trick Tips', 'Chuck Roth', 'Max Steel & Anthony Thornton', 'Hello Choir'], ['Indie Rock', 'Folk'], { price: SLIDING }),
  show('2026-10-01', '18:30', 'saintVitus', ['Incendiary', 'Sin Against Sin', 'Total Meltdown'], ['Hardcore']),
  show('2026-10-01', '19:30', 'tvEye', ['Veneraxiom', 'Glorious Descent', 'Satanic Magick', 'Funeral Dancer'], ['Metal']),
  show('2026-10-01', '19:00', 'broadway', ['Tahiti Syndrome', 'Leathered', 'The Disappearing Act', 'Diceholes'], ['Punk', 'Indie Rock']),
  show('2026-10-01', '19:00', 'williamsCenter', ['DAMAG3', 'Film and Gender', 'Connor Cristi'], ['Punk'], { timeTba: true }),
  show('2026-10-01', '20:00', 'whiteEagle', ['When Chai Met Toast'], ['Pop', 'Folk']),

  // Fri Oct 2
  show('2026-10-02', '19:00', 'sleepwalk', ["Seraphine's Cleaver", 'Crab', 'Bellcave'], ['Indie Rock'], { price: FREE }),
  show('2026-10-02', '20:00', 'hartBar', ['Love Free Spirit', 'Julia Santoli', 'Kitchenette', 'Axine M'], ['Experimental']),
  show('2026-10-02', '18:00', 'saintVitus', ['PIG', 'Cyanotic', 'DNE'], ['Industrial']),
  show('2026-10-02', '18:00', 'alphaville', ['Bad Static', '3 The Hardway', 'T@B GRRRL', 'Brea Fournier and the Dream Ballet'], ['Punk']),
  show('2026-10-02', '19:00', 'broadway', ['Annie Collette', 'Alphabet City', 'Help Wanted'], ['Indie Rock']),
  show('2026-10-02', '20:00', 'roulette', ['The Fiery Furnaces', 'Skeletons Big Band'], ['Indie Rock', 'Experimental'], { title: 'Us v. Them Night 2' }),
  show('2026-10-02', '22:00', 'bossaNova', ['KEBRA', 'Dj Rankng', 'La Maquina', 'zorenLo'], ['Electronic'], { title: 'Rollup', endTime: '23:59' }),

  // Sat Oct 3
  show('2026-10-03', '19:00', 'lightSound', ['Arto Lindsay', 'Dr. S+M', 'Beat Detectives', 'Exoplex', 'Stewey Decimal'], ['Experimental', 'Noise Rock'], { price: SLIDING, endTime: '23:00' }),
  show('2026-10-03', '16:00', 'mamaTried', ['Kyp Malone', 'MV Carbon', 'Sinead Youth'], ['Experimental'], { title: 'Friel Selects', price: SLIDING, endTime: '19:00' }),
  show('2026-10-03', '20:00', 'pioneerWorks', ['Kelsey Lu'], ['Pop', 'Experimental']),
  show('2026-10-03', '19:00', 'unionPool', ['Liam Kazar', 'Núria Graham'], ['Indie Rock', 'Folk']),
  show('2026-10-03', '19:00', 'alphaville', ['Hipsy Gap', 'Wetsuit', 'Shaggo'], ['Indie Rock']),
  show('2026-10-03', '18:00', 'saintVitus', ['Overkill', 'Tower'], ['Metal']),

  // Sun Oct 4
  show('2026-10-04', '19:00', 'unionPool', ['Hélène Barbier', 'Lightheaded', 'Home Blitz'], ['Indie Rock', 'Punk'], { title: 'Dot Dash presents' }),
  show('2026-10-04', '19:00', 'tvEye', ['Powerplant', 'Carrion Kids', 'Factory City Children'], ['Post-Punk', 'Punk']),
  show('2026-10-04', '19:00', 'salonKingston', ['Gabriel Zucker', 'Prairie Princess', 'Traveling Blind Cinema'], ['Experimental', 'Folk']),
  show('2026-10-04', '18:00', 'stripedLight', ['J. Pavone String Ensemble', 'Qiujiang Levi Lu & Lesley Mok', 'Bongsu Park'], ['Jazz & Improv', 'Experimental'], { endTime: '21:00' }),

  // Mon Oct 5
  show('2026-10-05', '18:00', 'saintVitus', ['Krallice', 'Veldune'], ['Metal']),
  show('2026-10-05', '19:30', 'tvEye', ['Leila Abdul-Rauf', 'Vaelastrasz', 'Dahjyn', 'Unfeeling'], ['Metal', 'Experimental']),
  show('2026-10-05', '20:30', 'unionPool', ['Rev. Vince Anderson & The Love Choir'], ['Soul & Gospel'], { price: FREE }),

  // Tue Oct 6
  show('2026-10-06', '19:00', 'broadway', ['The Schizophonics'], ['Garage', 'Punk']),

  // Wed Oct 7
  show('2026-10-07', '19:30', 'tvEye', ['Zanias', 'Korine'], ['Darkwave']),
  show('2026-10-07', '18:30', 'saintVitus', ['Yob'], ['Sludge & Doom', 'Metal']),

  // Thu Oct 8
  show('2026-10-08', '19:00', 'broadway', ['Cor de Lux', 'Editrix', 'Yuvees', 'Big Girl'], ['Noise Rock', 'Indie Rock']),
  show('2026-10-08', '19:00', 'unionPool', ['Washer', 'Or Best Offer', 'Bimbo', 'CS Cleaners'], ['Indie Rock', 'Noise Rock'], { title: 'Exploding In Sound 15th Anniversary' }),
  show('2026-10-08', '20:00', 'pioneerWorks', ['Horse Lords', 'Jules Reidy', 'Silk Fence'], ['Experimental']),
  show('2026-10-08', '20:00', 'purgatory', ['Peaer', 'Loadcard', 'Fraternal Twin'], ['Emo', 'Indie Rock']),

  // Fri Oct 9
  show('2026-10-09', '19:30', 'transPecos', ['Holidays in United States', 'aeiou', 'LiveYou', 'Glen Vine'], ['Experimental', 'Indie Rock']),
  show('2026-10-09', '19:30', 'tvEye', ['Today Is the Day', 'Body Stuff', 'Statiqbloom', 'FRKSE'], ['Noise Rock', 'Industrial']),
  show('2026-10-09', '19:00', 'saintVitus', ['Revocation', 'Defeated Sanity', 'Fuming Mouth'], ['Metal']),
  show('2026-10-09', '19:00', 'unionPool', ['Jenny Alien', 'Blisspoint', 'Theophobia'], ['Indie Rock']),
  show('2026-10-09', '19:00', 'alphaville', ['Bummer Camp', 'The Jump Cuts', 'Book/Spirit'], ['Indie Rock', 'Emo']),
  show('2026-10-09', '19:00', 'broadway', ['Desert Sharks', 'Nicole Yun', 'Van Chamberlain', 'Goodhue'], ['Shoegaze', 'Indie Rock']),
  show('2026-10-09', '19:00', 'kiSmith', ['Moss Cathedral', 'David Grubbs', 'Leah Coloff', 'John Brattin'], ['Experimental'], { endTime: '22:00' }),
  show('2026-10-09', '19:00', 'dingbatz', ['The Dread Crew of Oddwood'], ['Metal', 'Folk'], { timeTba: true }),

  // Sat Oct 10
  show('2026-10-10', '19:00', 'saintVitus', ['Kowloon Walled City', 'Great Falls'], ['Sludge & Doom', 'Noise Rock']),
  show('2026-10-10', '16:00', 'mamaTried', ['Cat City', 'Gladys', 'Tough Darling'], ['Indie Rock', 'Punk'], { price: SLIDING, endTime: '19:00' }),
  show('2026-10-10', '20:00', 'veryFriendly', ['Amphibian', 'Mouths Agape', 'Mike Alfieri'], ['Experimental']),
  show('2026-10-10', '19:00', 'broadway', ['THICK', 'Big Girl', 'Cotillion'], ['Punk']),
  show('2026-10-10', '19:30', 'tvEye', ['Cutouts'], ['Indie Rock']),

  // Sun Oct 11
  show('2026-10-11', '19:00', 'alphaville', ['koleżanka'], ['Indie Rock'], { title: 'koleżanka album release' }),
  show('2026-10-11', '19:00', 'broadway', ['Axine M', 'was', 'Psalter'], ['Experimental'], { endTime: '23:00' }),
  show('2026-10-11', '19:00', 'unionPool', ['Real Young', 'Lazy Horse'], ['Indie Rock']),

  // Mon Oct 12 – Thu Oct 15
  show('2026-10-12', '20:00', 'broadway', ['Better Living', 'Lowe Cellar', 'Star Card'], ['Indie Rock']),
  show('2026-10-13', '18:00', 'saintVitus', ['The Dillinger Escape Plan', 'thoughtcrimes', 'Bore'], ['Metal', 'Hardcore']),
  show('2026-10-13', '19:00', 'unionPool', ['Ian Sweet', 'Meg Elsier'], ['Indie Rock']),
  show('2026-10-14', '19:00', 'broadway', ['Somerset Thrower', 'Broken Record', 'Sadlands', 'Radar'], ['Emo', 'Indie Rock']),
  show('2026-10-15', '19:30', 'tvEye', ['Roger Clark Miller', 'Donna Allen', 'jel'], ['Post-Punk']),
  show('2026-10-15', '19:00', 'unionPool', ['Andy Boay', 'Pc Worship'], ['Noise Rock', 'Indie Rock']),
  show('2026-10-15', '18:00', 'saintVitus', ['Inter Arma', 'Chained to the Bottom of the Ocean'], ['Sludge & Doom', 'Metal']),

  // Fri Oct 16
  show('2026-10-16', '20:00', 'tvEye', ['K-Holes', 'Genre is Death', 'CRUSH', 'DJ Jonathan Toubin'], ['Punk', 'Garage']),
  show('2026-10-16', '19:00', 'irvingPlaza', ['Rocket From The Crypt'], ['Punk', 'Garage']),
  show('2026-10-16', '19:00', 'unionPool', ['Billboard Style', 'Like A Doll', 'May Shining Windows'], ['Indie Rock']),
  show('2026-10-16', '18:30', 'alphaville', ['Half Step', 'Chris Lyons', 'Adam Amram', 'Underground River'], ['Indie Rock', 'Folk']),

  // Sat Oct 17
  show('2026-10-17', '19:30', 'tvEye', ['Acid Mothers Temple', 'Magick Potion'], ['Psych']),
  show('2026-10-17', '18:00', 'saintVitus', ['AJJ', 'Greet Death'], ['Punk', 'Folk', 'Shoegaze']),
  show('2026-10-17', '20:00', 'broadway', ['Lab Rat', 'Drogato', 'Fanboys', 'B.A.D.G.E.', 'Kasso'], ['Punk']),
  show('2026-10-17', '19:00', 'alphaville', ['Current Blue', 'Makeout City', 'URL'], ['Indie Rock']),

  // Sun Oct 18
  show('2026-10-18', '19:00', 'tvEye', ['The Number Twelve Looks Like You', 'Kaonashi', 'Differences'], ['Screamo', 'Hardcore']),
  show('2026-10-18', '18:00', 'saintVitus', ['Spy'], ['Hardcore']),
  show('2026-10-18', '19:00', 'unionPool', ['Growing', 'Ryan Sawyer Shaker Ensemble'], ['Experimental']),

  // Oct 20 – Oct 25
  show('2026-10-20', '19:00', 'unionPool', ['The Courettes', 'The Dracu-Las', 'Todd-O-Phonic Todd'], ['Garage']),
  show('2026-10-21', '19:30', 'tvEye', ['Sungaze', 'Lavisher', 'Semaphore'], ['Shoegaze']),
  show('2026-10-22', '19:30', 'tvEye', ['Asher White', "Nara's Room", 'Retail Drugs'], ['Experimental', 'Indie Rock']),
  show('2026-10-22', '19:00', 'transPecos', ['Sarah Katherine Lawless', "Sofia D'Angelo", 'Evangeline Young'], ['Folk', 'Indie Rock'], { title: 'Look Alive EP release', source: donyc('trans-pecos') }),
  show('2026-10-22', '18:00', 'saintVitus', ['Missing Link', 'Age of Apocalypse', 'Gemstar'], ['Hardcore']),
  show('2026-10-23', '19:00', 'saintVitus', ['Blackbraid', 'High Command', 'Gudsforladt'], ['Metal']),
  show('2026-10-23', '19:00', 'broadway', ['Classic Traffic', 'Pet Fox', 'Dagwood', 'Candybar'], ['Indie Rock', 'Emo']),
  show('2026-10-23', '19:00', 'unionPool', ['Matthew Danger Lippman', 'Horror Movie Marathon', 'Star 80'], ['Indie Rock']),
  show('2026-10-24', '19:00', 'broadway', ['Radiator Hospital', 'DUSK'], ['Indie Rock', 'Punk']),
  show('2026-10-25', '19:30', 'tvEye', ['Flooding', 'bloodsports', 'AEIOU'], ['Shoegaze', 'Noise Rock']),
  show('2026-10-25', '19:00', 'broadway', ['Wiring', 'Fib', 'Papy Lady', 'nat shaheen'], ['Indie Rock']),

  // Oct 28 – Oct 31
  show('2026-10-28', '18:00', 'saintVitus', ['Devil Master'], ['Metal', 'Punk']),
  show('2026-10-28', '19:00', 'marketHotel', ["Ak'chamel", 'Ecology Homestones'], ['Psych', 'Experimental'], { price: { min: 9, max: 9 } }),
  show('2026-10-30', '18:00', 'saintVitus', ['Ink & Dagger', 'Saetia'], ['Screamo', 'Hardcore']),
  show('2026-10-30', '19:00', 'unionPool', ['Man/Woman/Chainsaw'], ['Post-Punk', 'Indie Rock']),
  show('2026-10-31', '18:00', 'saintVitus', ['High On Fire'], ['Metal', 'Sludge & Doom']),

  // November
  show('2026-11-04', '18:00', 'saintVitus', ['Wolf & Bear', 'Coletta', 'Origami Button'], ['Emo', 'Hardcore']),
  show('2026-11-05', '18:00', 'saintVitus', ['Forbidden', 'Heathen', 'Void'], ['Metal']),
  show('2026-11-06', '18:00', 'saintVitus', ['Flipper', 'Crippling Alcoholism', '95 Bulls'], ['Punk', 'Post-Punk']),
  show('2026-11-07', '18:00', 'saintVitus', ['Torche', 'Spotlights'], ['Sludge & Doom', 'Shoegaze']),
  show('2026-11-07', '19:00', 'purgatory', ['Little Hag', 'Jenny Alien', 'QWAM', 'Brook Pridemore'], ['Indie Rock', 'Folk']),
  show('2026-11-12', '19:00', 'broadway', ['V.V. Lightbody'], ['Folk', 'Indie Rock']),
  show('2026-11-13', '14:00', 'montyHall', [], ['Experimental'], { title: 'Avant Radio Festival' }),
];

/** Lookup by id. */
export const SHOWS_BY_ID: Record<string, Show> = Object.fromEntries(SHOWS.map((s) => [s.id, s]));

// Keep ids unique even if two listings share a date, venue and headliner.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  const seen = new Set<string>();
  for (const s of SHOWS) {
    if (seen.has(s.id)) console.warn(`Duplicate show id ${s.id}`);
    seen.add(s.id);
  }
}
