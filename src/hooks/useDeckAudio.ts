import { preload, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { playableActs, resolveShow, reresolveShow, useShowPreviews, type ActPreview } from '@/lib/previews';
import { useApp } from '@/lib/store';
import type { Show } from '@/lib/types';

type Found = Extract<ActPreview, { status: 'found' }>;

/** expo-audio players are imperative objects; volume is set by assignment. */
function setPlayerVolume(player: AudioPlayer, v: number) {
  player.volume = Math.max(0, Math.min(1, v));
}

/**
 * One player follows whichever card is on top. The next card's first preview
 * is preloaded so it starts quickly once the top card is swiped away.
 */
export function useDeckAudio(top: Show | undefined, upcoming: Show[], enabled: boolean) {
  const autoplay = useApp((s) => s.autoplay);
  const flagWrongArtist = useApp((s) => s.flagWrongArtist);
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const previews = useShowPreviews(top?.id);
  const nextPreviews = useShowPreviews(upcoming[0]?.id);
  const topId = top?.id;

  // Act index and pause state belong to one card; a new top card starts fresh.
  const [sel, setSel] = useState<{ id?: string; idx: number; paused: boolean | null }>({
    id: topId,
    idx: 0,
    paused: null,
  });
  const current = sel.id === topId ? sel : { id: topId, idx: 0, paused: null };
  const paused = current.paused ?? !autoplay;

  const playable = playableActs(previews);
  const idx = Math.min(current.idx, Math.max(0, playable.length - 1));
  const act: Found | undefined = playable[idx];
  const url = act?.track.previewUrl ?? '';
  const key = topId && url ? `${topId}|${url}` : null;

  const loaded = useRef<string | null>(null);
  const finishedFor = useRef<string | null>(null);
  const live = useRef({ key, idx, count: playable.length, topId });
  useEffect(() => {
    live.current = { key, idx, count: playable.length, topId };
  });

  const nextIds = upcoming.map((s) => s.id).join('|');
  // Resolve the top card and the two behind it.
  useEffect(() => {
    if (top) resolveShow(top);
    upcoming.slice(0, 2).forEach((s) => resolveShow(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId, nextIds]);

  // Load and play or pause the current preview.
  useEffect(() => {
    if (!key) {
      player.pause();
      return;
    }
    if (loaded.current !== key) {
      setPlayerVolume(player, 1);
      player.replace({ uri: url });
      loaded.current = key;
      finishedFor.current = null;
    }
    if (enabled && !paused) player.play();
    else player.pause();
  }, [key, url, enabled, paused, player]);

  // Preload the next card's first preview.
  const nextUrl = playableActs(nextPreviews)[0]?.track.previewUrl;
  useEffect(() => {
    if (nextUrl) preload({ uri: nextUrl }).catch(() => {});
  }, [nextUrl]);

  // When a preview ends, move on to the next act on the bill, then stop.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      const l = live.current;
      if (!st.didJustFinish || !l.key || finishedFor.current === l.key) return;
      finishedFor.current = l.key;
      setSel({
        id: l.topId,
        idx: l.idx < l.count - 1 ? l.idx + 1 : l.idx,
        paused: l.idx < l.count - 1 ? false : true,
      });
    });
    return () => sub.remove();
  }, [player]);

  const toggle = useCallback(() => {
    if (!act) return;
    if (status.playing) {
      setSel({ id: topId, idx, paused: true });
      return;
    }
    if (finishedFor.current === key || (status.duration > 0 && status.currentTime >= status.duration - 0.25)) {
      player.seekTo(0).catch(() => {});
      finishedFor.current = null;
    }
    setSel({ id: topId, idx, paused: false });
    player.play();
  }, [act, key, idx, topId, player, status.playing, status.duration, status.currentTime]);

  const nextAct = useCallback(() => {
    if (playable.length < 2) return;
    setSel({ id: topId, idx: (idx + 1) % playable.length, paused: false });
  }, [playable.length, idx, topId]);

  const setVolume = useCallback((v: number) => setPlayerVolume(player, v), [player]);
  const stop = useCallback(() => player.pause(), [player]);

  const wrongArtist = useCallback(
    (a: Found) => {
      flagWrongArtist(a.actName, a.artistId);
      if (top) reresolveShow(top);
    },
    [flagWrongArtist, top],
  );

  return {
    loading: !previews || previews.state === 'loading',
    playable,
    current: act,
    index: idx,
    playing: status.playing,
    progress: status.duration > 0 ? status.currentTime / status.duration : 0,
    toggle,
    nextAct,
    setVolume,
    stop,
    wrongArtist,
  };
}
