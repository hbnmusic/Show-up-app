/**
 * The steps between "something was shared to Setnik" and "recognised text sent for processing".
 * Written against injected dependencies so every branch is tested without a phone. The flyer image never leaves the phone:
 * only prepared text (see prepare.ts) is sent.
 */
import { fetchPreview, isSafeUrl, type Preview } from '../../../supabase/functions/_shared/linkfetch';
import type { Result, SubmitReply } from '../fp/api';
import { prepareOcr, withCaption, MIN_TEXT, type OcrResult, type Prepared } from './prepare';

export const LINK_FAILED_MESSAGE = "Couldn't get the flyer from that link. Share a screenshot instead.";

export type FlyerDeps = {
  ocr: (uri: string) => Promise<{ ok: true; result: OcrResult } | { ok: false; error: 'unavailable' | 'failed' }>;
  /** Phone-side read of the one shared public page. */
  previewOnPhone: (url: string) => Promise<Preview | null>;
  /** Server fallback (the link-fetch function). Needs an account. */
  previewOnServer: (url: string) => Promise<Preview | null>;
  submit: (body: { text: string; layout: string; metro?: string; origin: 'image' | 'link' }) => Promise<Result<SubmitReply>>;
  track: (name: 'flyer_ocr' | 'flyer_result' | 'link_fetch' | 'ai_quota', props: Record<string, string | number | boolean>) => void;
  now?: () => number;
};

export type Outcome =
  | { kind: 'submitted'; reply: SubmitReply; imageUri?: string }
  | { kind: 'link_failed' }
  | { kind: 'no_text' }
  | { kind: 'too_long' }
  | { kind: 'unavailable' }
  | { kind: 'error'; code: string; message: string };

const bucket = (n: number) => (n < 100 ? '<100' : n < 300 ? '<300' : n < 800 ? '<800' : '800+');

const errorMessage = (code: string): string =>
  code === 'limit' ? 'You have reached today\'s limit for sharing flyers. Try again tomorrow.'
  : code === 'banned' ? 'This account cannot share flyers.'
  : code === 'terms' ? 'Accept the Terms of Use first.'
  : code === 'bad_text' ? 'That did not look like a flyer with readable text.'
  : code === 'network' || code === 'timeout' ? 'Could not reach the server. Check your connection and try again.'
  : 'Something went wrong. Try again in a minute.';

/** Image → recognised text → prepared text. Nothing is sent. */
export async function readFlyerImage(uri: string, d: FlyerDeps, caption?: string): Promise<{ prepared: Extract<Prepared, { text: string }> } | Outcome> {
  const t0 = (d.now ?? Date.now)();
  const r = await d.ocr(uri);
  if (!r.ok) {
    d.track('flyer_ocr', { ok: false, why: r.error });
    return r.error === 'unavailable' ? { kind: 'unavailable' } : { kind: 'error', code: r.error, message: 'Could not read that image.' };
  }
  const p = prepareOcr({ ...r.result, text: withCaption(r.result.text, caption) });
  d.track('flyer_ocr', { ok: !('error' in p), blocks: r.result.blocks.length, chars: bucket(r.result.text.length), ms: Math.min(60000, (d.now ?? Date.now)() - t0) });
  if ('error' in p) return { kind: p.error === 'too_long' ? 'too_long' : 'no_text' };
  return { prepared: p };
}

export async function sendPrepared(p: { text: string; layout: string }, metro: string | undefined, origin: 'image' | 'link', d: FlyerDeps): Promise<Outcome> {
  const r = await d.submit({ text: p.text, layout: p.layout, metro, origin });
  if (!r.ok) {
    const code = r.code ?? r.error;
    d.track('flyer_result', { result: 'error', code: code.slice(0, 30) });
    return { kind: 'error', code, message: errorMessage(code) };
  }
  d.track('flyer_result', { result: r.data.result ?? 'unknown', status: r.data.status ?? 'unknown' });
  if (r.data.quotaHit || r.data.status === 'retry') d.track('ai_quota', { hit: true });
  return { kind: 'submitted', reply: r.data };
}

/** A shared link: read the one public page (phone first, then the server), recognise the preview image, send the text. */
export async function handleLink(url: string, metro: string | undefined, d: FlyerDeps, haveAccount: () => Promise<boolean>): Promise<Outcome> {
  if (!isSafeUrl(url)) {
    d.track('link_fetch', { via: 'none', ok: false });
    return { kind: 'link_failed' };
  }
  let via: 'phone' | 'server' = 'phone';
  let pv = await d.previewOnPhone(url).catch(() => null);
  if (!pv?.imageUrl && !(pv?.caption && pv.caption.length >= MIN_TEXT * 3)) {
    pv = null;
    if (await haveAccount()) {
      via = 'server';
      pv = await d.previewOnServer(url).catch(() => null);
    }
  }
  d.track('link_fetch', { via, ok: Boolean(pv?.imageUrl || pv?.caption) });
  if (!pv || (!pv.imageUrl && !pv.caption)) return { kind: 'link_failed' };
  if (pv.imageUrl) {
    const read = await readFlyerImage(pv.imageUrl, d, pv.caption);
    if ('prepared' in read) {
      const o = await sendPrepared(read.prepared, metro, 'link', d);
      return o.kind === 'submitted' ? { ...o, imageUri: pv.imageUrl } : o;
    }
    if (read.kind === 'unavailable') return read;
  }
  // No readable image: the caption alone may carry the details.
  const p = pv.caption ? prepareOcr({ text: pv.caption, blocks: [] }) : null;
  if (p && !('error' in p)) return sendPrepared(p, metro, 'link', d);
  return { kind: 'link_failed' };
}

/** Plain text shared to the app (not a link): used as the flyer text directly. */
export async function handleText(text: string, metro: string | undefined, d: FlyerDeps): Promise<Outcome> {
  const p = prepareOcr({ text, blocks: [] });
  if ('error' in p) return { kind: p.error === 'too_long' ? 'too_long' : 'no_text' };
  return sendPrepared(p, metro, 'link', d);
}

export const phonePreview = (url: string) => fetchPreview(url).catch(() => null);
