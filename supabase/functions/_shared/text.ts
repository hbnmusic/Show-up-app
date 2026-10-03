/** Name matching helpers shared by venue resolution, show matching and evidence checks. */

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'le', 'la', 'les', 'de', 'du']);

export const tokens = (s: string): string[] => norm(s).split(' ').filter((t) => t && !STOP.has(t));

/** Drops "<promoter> presents:" lead-ins and trailing tour or show-time notes so only the act name is compared. */
export function cleanActName(s: string): string {
  let t = s.trim();
  const pres = /^(.{2,60}?)\s+(?:presents?|présente|presente)\s*:?\s+(.+)$/i.exec(t);
  if (pres) t = pres[2];
  t = t
    .replace(/\((?:early|late|matinee|1st|2nd|first|second)\s+show\)/gi, '')
    .replace(/[-–—]\s*(?:early|late)\s+show\b/gi, '')
    .replace(/\b(?:early|late)\s+show\b/gi, '')
    .replace(/\b(?:album release|record release|tour|live)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || s.trim();
}

/** 0..1 similarity of two names after cleaning. 1 = same words; containment of a multi-word or long name scores 0.9. */
export function similarity(a: string, b: string): number {
  const ta = tokens(cleanActName(a));
  const tb = tokens(cleanActName(b));
  if (ta.length === 0 || tb.length === 0) return 0;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja === jb) return 1;
  if (ja.replace(/ /g, '') === jb.replace(/ /g, '')) return 0.98; // "dead end" vs "deadend"
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jac = inter / (sa.size + sb.size - inter);
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  const contained = [...small].every((t) => big.has(t));
  const smallStr = [...small].join(' ');
  const containment = contained && (small.size >= 2 || smallStr.length >= 6) ? 0.9 : 0;
  return Math.max(jac, containment);
}

/** True when `needle` appears in `haystack` ignoring case, accents, punctuation and spacing. */
export function appearsIn(needle: string, haystack: string): boolean {
  const n = norm(needle).replace(/ /g, '');
  if (n.length < 2) return false;
  return norm(haystack).replace(/ /g, '').includes(n);
}
