import type { Genre } from '@/lib/types';

export const C = {
  bg: '#0C0B0A',
  surface: '#171614',
  surface2: '#211F1C',
  line: '#2F2C28',
  text: '#F3EEE4',
  muted: '#A39C90',
  faint: '#6F695F',
  accent: '#FF5A36',
  accentInk: '#1A0A05',
  pass: '#E9E4DA',
  good: '#7BD88F',
  warn: '#F6C453',
  danger: '#FF6B6B',
} as const;

export const F = {
  poster: 'Anton_400Regular',
  block: 'ArchivoBlack_400Regular',
  ui: 'SpaceGrotesk_500Medium',
  uiRegular: 'SpaceGrotesk_400Regular',
  uiBold: 'SpaceGrotesk_700Bold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export type PosterPalette = { bg: string; ink: string; accent: string };

const HEAVY: PosterPalette[] = [
  { bg: '#0E0E0E', ink: '#F2EDE3', accent: '#D7263D' },
  { bg: '#E9E4D8', ink: '#0E0E0E', accent: '#B3001B' },
  { bg: '#1A1A1A', ink: '#D9D2C3', accent: '#8C8C8C' },
];
const PUNK: PosterPalette[] = [
  { bg: '#FF5A36', ink: '#111111', accent: '#F2EDE3' },
  { bg: '#F2EDE3', ink: '#111111', accent: '#FF5A36' },
  { bg: '#FFE14D', ink: '#111111', accent: '#E0301E' },
];
const DARK: PosterPalette[] = [
  { bg: '#1B1330', ink: '#E7DBFF', accent: '#9B7BFF' },
  { bg: '#101010', ink: '#F2EDE3', accent: '#7A5CFF' },
  { bg: '#2A0F1C', ink: '#F7D6E3', accent: '#E0457B' },
];
const DREAMY: PosterPalette[] = [
  { bg: '#F7C6D9', ink: '#1C1330', accent: '#5B3FD1' },
  { bg: '#BFD7FF', ink: '#101828', accent: '#FF5A36' },
  { bg: '#E6E0CF', ink: '#2C3E2F', accent: '#3A7D44' },
];
const EXPERIMENTAL: PosterPalette[] = [
  { bg: '#2F3BFF', ink: '#F2EDE3', accent: '#E8FF5A' },
  { bg: '#E8FF5A', ink: '#111111', accent: '#2F3BFF' },
  { bg: '#F2EDE3', ink: '#2F3BFF', accent: '#111111' },
];
const CLUB: PosterPalette[] = [
  { bg: '#0A0A0A', ink: '#E8FF5A', accent: '#FF3DA5' },
  { bg: '#12003A', ink: '#7CF9FF', accent: '#FF3DA5' },
];
const SOUL: PosterPalette[] = [{ bg: '#F5B700', ink: '#2A1600', accent: '#B8290F' }];

const FAMILY: Partial<Record<Genre, PosterPalette[]>> = {
  Metal: HEAVY,
  'Sludge & Doom': HEAVY,
  Hardcore: HEAVY,
  Industrial: DARK,
  Darkwave: DARK,
  'Post-Punk': DARK,
  Punk: PUNK,
  Garage: PUNK,
  Screamo: PUNK,
  Emo: PUNK,
  Shoegaze: DREAMY,
  'Indie Rock': DREAMY,
  Folk: DREAMY,
  Pop: DREAMY,
  Experimental: EXPERIMENTAL,
  'Noise Rock': EXPERIMENTAL,
  'Jazz & Improv': EXPERIMENTAL,
  Psych: EXPERIMENTAL,
  'Electronic': CLUB,
  'Soul & Gospel': SOUL,
  Rock: PUNK,
  Country: SOUL,
  Blues: DARK,
  'Hip-Hop': CLUB,
  Classical: DREAMY,
  Latin: SOUL,
  Reggae: SOUL,
};

/** Stable small hash so a show always gets the same poster. */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function paletteFor(id: string, genres: Genre[]): PosterPalette {
  const fam = FAMILY[genres[0]] ?? DREAMY;
  return fam[hash(id) % fam.length];
}

/** Seeded pseudo-random numbers in [0, 1). */
export function seeded(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
