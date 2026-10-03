/** Maps genre words a flyer or venue page states to the app's genre list. Unknown words map to nothing; names are never used to guess. */
export type AppGenre =
  | 'Punk' | 'Hardcore' | 'Screamo' | 'Emo' | 'Post-Punk' | 'Darkwave' | 'Industrial' | 'Garage' | 'Indie Rock'
  | 'Shoegaze' | 'Noise Rock' | 'Metal' | 'Sludge & Doom' | 'Psych' | 'Folk' | 'Pop' | 'Experimental'
  | 'Jazz & Improv' | 'Electronic' | 'Soul & Gospel' | 'Rock' | 'Country' | 'Blues' | 'Hip-Hop' | 'Classical' | 'Latin' | 'Reggae';

// Most specific first.
const RULES: [RegExp, AppGenre][] = [
  [/post[- ]?punk/, 'Post-Punk'],
  [/post[- ]?hardcore|hardcore/, 'Hardcore'],
  [/screamo/, 'Screamo'],
  [/\bemo\b/, 'Emo'],
  [/dark ?wave|goth|cold ?wave/, 'Darkwave'],
  [/industrial|ebm/, 'Industrial'],
  [/garage/, 'Garage'],
  [/indie/, 'Indie Rock'],
  [/shoegaze|dream ?pop/, 'Shoegaze'],
  [/noise/, 'Noise Rock'],
  [/sludge|doom|stoner/, 'Sludge & Doom'],
  [/metal/, 'Metal'],
  [/psych/, 'Psych'],
  [/punk/, 'Punk'],
  [/folk|bluegrass|americana|singer[- ]?songwriter/, 'Folk'],
  [/experimental|avant|improv/, 'Experimental'],
  [/jazz/, 'Jazz & Improv'],
  [/techno|house|electronic|edm|synth|ambient|drum and bass|dnb/, 'Electronic'],
  [/soul|gospel|r&b|rnb|funk/, 'Soul & Gospel'],
  [/hip[- ]?hop|\brap\b/, 'Hip-Hop'],
  [/country|honky/, 'Country'],
  [/blues/, 'Blues'],
  [/classical|orchestra|symphon|chamber|opera/, 'Classical'],
  [/latin|salsa|cumbia|reggaeton|bachata|merengue/, 'Latin'],
  [/reggae|dub\b|ska\b/, 'Reggae'],
  [/\bpop\b/, 'Pop'],
  [/\brock\b/, 'Rock'],
];

export function mapStatedGenres(text: string | null | undefined): AppGenre[] {
  if (!text) return [];
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const out: AppGenre[] = [];
  for (const part of t.split(/[,/;|]+/)) {
    for (const [re, g] of RULES) {
      if (re.test(part)) {
        if (!out.includes(g)) out.push(g);
        break;
      }
    }
  }
  return out.slice(0, 3);
}
