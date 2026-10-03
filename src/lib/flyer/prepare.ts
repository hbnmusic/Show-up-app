/**
 * Turns on-device text recognition output into what leaves the phone: plain text and a short layout hint.
 * The image itself is never sent. Emails, phone numbers and social handles/links are removed here, on the phone,
 * and the server removes them again.
 */
import { redactText } from '../../../supabase/functions/_shared/redact';

export type OcrFrame = { left: number; top: number; width: number; height: number };
export type OcrLine = { text: string; frame?: OcrFrame };
export type OcrBlock = { text: string; frame?: OcrFrame; lines: OcrLine[] };
export type OcrResult = { text: string; blocks: OcrBlock[] };

export const MIN_TEXT = 15;
export const MAX_TEXT = 8000;
export const MAX_LAYOUT = 4000;

export type Prepared = { text: string; layout: string; blocks: number; chars: number } | { error: 'no_text' | 'too_long' };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Layout hint, one line per block in reading order: where it sits (top/upper/middle/lower/bottom) and its type size relative to the typical line. */
export function layoutHints(blocks: OcrBlock[]): string {
  const framed = blocks.filter((b) => b.frame && b.text.trim());
  if (!framed.length) return '';
  const top = Math.min(...framed.map((b) => b.frame!.top));
  const bottom = Math.max(...framed.map((b) => b.frame!.top + b.frame!.height));
  const span = Math.max(1, bottom - top);
  const lineHeights = framed.flatMap((b) => b.lines.map((l) => l.frame?.height ?? 0).filter((h) => h > 0));
  const typical = median(lineHeights) || 1;
  const rows = [...framed].sort((a, b) => a.frame!.top - b.frame!.top || a.frame!.left - b.frame!.left).map((b) => {
    const mid = (b.frame!.top + b.frame!.height / 2 - top) / span;
    const where = mid < 0.15 ? 'top' : mid < 0.4 ? 'upper' : mid < 0.6 ? 'middle' : mid < 0.85 ? 'lower' : 'bottom';
    const hs = b.lines.map((l) => l.frame?.height ?? 0).filter((h) => h > 0);
    const size = hs.length ? Math.round((Math.max(...hs) / typical) * 10) / 10 : 1;
    return `[${where}, size ${size}x] ${b.text.replace(/\s*\n\s*/g, ' / ').trim()}`;
  });
  return redactText(rows.join('\n')).slice(0, MAX_LAYOUT);
}

export function prepareOcr(r: OcrResult): Prepared {
  const text = redactText((r.text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')).trim();
  // Text that is only removal markers is not a flyer.
  const readable = text.replace(/\[(?:email|phone|handle|social link) removed\]/g, '').replace(/\s+/g, '');
  if (readable.length < MIN_TEXT) return { error: 'no_text' };
  if (text.length > MAX_TEXT) return { error: 'too_long' };
  return { text, layout: layoutHints(r.blocks ?? []), blocks: r.blocks?.length ?? 0, chars: text.length };
}

/** Caption text from a shared post (already public) joins the flyer text so dates in the caption are available. */
export function withCaption(text: string, caption?: string): string {
  const c = (caption ?? '').trim();
  if (!c) return text;
  return `${text}\n\nPost caption:\n${c.slice(0, 1500)}`;
}
