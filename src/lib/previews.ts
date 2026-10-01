import { create } from 'zustand';

import { chooseArtist, isCollaboration, searchArtists, topTrack, type Confidence, type Track } from './deezer';
import { useApp } from './store';
import type { Show } from './types';

export type ActPreview =
  | {
      status: 'found';
      actName: string;
      order: number;
      artistId: number;
      confidence: Confidence;
      track: Track;
      /** Artist photo from the catalog match, used on the card. */
      picture?: string;
    }
  | {
      status: 'none';
      actName: string;
      order: number;
      reason: 'no-match' | 'collab' | 'error';
    };

export type ShowPreviews = {
  state: 'loading' | 'done';
  acts: ActPreview[];
};

type PreviewStore = {
  byShow: Record<string, ShowPreviews>;
};

export const usePreviewStore = create<PreviewStore>()(() => ({ byShow: {} }));

const MOCK = process.env.EXPO_PUBLIC_MOCK_PREVIEWS === '1';

// ---- small request queue so a fast swiper doesn't flood the API ----
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---- per-act cache (acts repeat across shows) ----
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type ActResult = DistributiveOmit<ActPreview, 'order'>;
const actCache = new Map<string, { at: number; promise: Promise<ActResult> }>();
/** Deezer preview links are signed and expire, so re-resolve after a while. */
const ACT_TTL_MS = 45 * 60 * 1000;

function actKey(name: string, rejected: number[]): string {
  return `${name.toLowerCase()}|${rejected.join(',')}`;
}

async function resolveAct(name: string, rejected: number[]): Promise<ActResult> {
  if (isCollaboration(name)) return { status: 'none', actName: name, reason: 'collab' };
  if (MOCK) {
    return {
      status: 'found',
      actName: name,
      artistId: name.length,
      confidence: name.length % 4 === 0 ? 'possible' : 'high',
      track: { title: `${name} (sample track)`, artistName: name, previewUrl: '' },
    };
  }
  try {
    const candidates = await limited(() => searchArtists(name));
    const match = chooseArtist(name, candidates, rejected);
    if (match.kind === 'none') return { status: 'none', actName: name, reason: 'no-match' };
    const track = await limited(() => topTrack(match.artist.id));
    if (!track) return { status: 'none', actName: name, reason: 'no-match' };
    return {
      status: 'found',
      actName: name,
      artistId: match.artist.id,
      confidence: match.confidence,
      track,
      picture: match.artist.picture,
    };
  } catch {
    return { status: 'none', actName: name, reason: 'error' };
  }
}

function cachedAct(name: string): Promise<ActResult> {
  const rejected = useApp.getState().wrongArtist[name.toLowerCase()] ?? [];
  const key = actKey(name, rejected);
  const hit = actCache.get(key);
  if (hit && Date.now() - hit.at < ACT_TTL_MS) return hit.promise;
  const promise = resolveAct(name, rejected).then((r) => {
    // Don't keep failures around; a network blip shouldn't stick for 45 minutes.
    if (r.status === 'none' && r.reason === 'error') actCache.delete(key);
    return r;
  });
  actCache.set(key, { at: Date.now(), promise });
  return promise;
}

function setShow(showId: string, value: ShowPreviews) {
  usePreviewStore.setState((s) => ({ byShow: { ...s.byShow, [showId]: value } }));
}

/**
 * Resolve every act on the bill, headliner first. The store updates as each
 * act comes back, so the card can start playing before the whole bill is done.
 */
export async function resolveShow(show: Show, force = false): Promise<void> {
  const existing = usePreviewStore.getState().byShow[show.id];
  if (existing && !force) return;
  const acts = [...show.acts].sort((a, b) => a.order - b.order);
  const results: ActPreview[] = [];
  setShow(show.id, { state: 'loading', acts: [] });
  if (acts.length === 0) {
    setShow(show.id, { state: 'done', acts: [] });
    return;
  }
  // Headliner first so the top card has something to play quickly.
  const [head, ...rest] = acts;
  const headResult = await cachedAct(head.name);
  results.push({ ...headResult, order: head.order } as ActPreview);
  setShow(show.id, { state: 'loading', acts: [...results] });
  const others = await Promise.all(rest.map((a) => cachedAct(a.name)));
  others.forEach((r, i) => results.push({ ...r, order: rest[i].order } as ActPreview));
  setShow(show.id, { state: 'done', acts: results.sort((a, b) => a.order - b.order) });
}

/** Drop a show's results and resolve again (after a "wrong artist" report). */
export function reresolveShow(show: Show) {
  for (const a of show.acts) {
    const rejected = useApp.getState().wrongArtist[a.name.toLowerCase()] ?? [];
    actCache.delete(actKey(a.name, rejected));
  }
  return resolveShow(show, true);
}

export function playableActs(p: ShowPreviews | undefined) {
  return (p?.acts ?? []).filter((a): a is Extract<ActPreview, { status: 'found' }> => a.status === 'found');
}

export function useShowPreviews(showId: string | undefined): ShowPreviews | undefined {
  return usePreviewStore((s) => (showId ? s.byShow[showId] : undefined));
}
