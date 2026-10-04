import { Ionicons } from '@expo/vector-icons';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { AudioBar } from '@/components/AudioBar';
import { Chip } from '@/components/Chip';
import { Deck, type DeckHandle } from '@/components/Deck';
import { C, F } from '@/constants/theme';
import { useAppActive, useNow } from '@/hooks/useNow';
import { usePriceUi } from '@/hooks/usePriceUi';
import { useFlag } from '@/lib/flags';
import { useDeckAudio } from '@/hooks/useDeckAudio';
import { recordDecision } from '@/lib/decide';
import { useDeckState } from '@/lib/deckState';
import { activeFilterCount, buildQueue, WHEN_LABELS } from '@/lib/filters';
import { useListings } from '@/lib/listingsStore';
import { playableActs, usePreviewStore } from '@/lib/previews';
import { syncReminders } from '@/lib/reminders';
import { useApp } from '@/lib/store';
import { communityEnabled } from '@/lib/communityConfig';
import { DEFAULT_FILTERS, type Decision, type Show } from '@/lib/types';

export default function ShowsScreen() {
  const now = useNow();
  const focused = useIsFocused();
  const active = useAppActive();
  const decisionsRec = useApp((s) => s.decisions);
  const allShows = useListings((s) => s.shows);
  const feeds = useListings((s) => s.feeds);
  const listingsRefreshing = useListings((s) => s.refreshing);
  const listingsError = useListings((s) => s.error);
  const stored = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const resetFilters = useApp((s) => s.resetFilters);
  const history = useApp((s) => s.history);
  const priceUi = usePriceUi();
  const deezerOn = useFlag('deezer_enabled');
  const filters = stored;
  const deckRef = useRef<DeckHandle>(null);
  const drag = useSharedValue(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [enterFrom, setEnterFrom] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const pinnedId = useDeckState((s) => s.pinnedId);

  const decisions = useMemo(() => {
    const out: Record<string, Decision> = {};
    for (const [id, r] of Object.entries(decisionsRec)) out[id] = r.decision;
    return out;
  }, [decisionsRec]);

  const queue = useMemo(
    () => buildQueue(allShows, filters, decisions, now, pinnedId),
    [allShows, filters, decisions, now, pinnedId],
  );
  // A price filter picked earlier stops applying once the city has too few known prices to make it useful.
  useEffect(() => {
    if (allShows.length > 0 && !priceUi && filters.price !== 'any') setFilters({ price: 'any' });
  }, [allShows.length, priceUi, filters.price, setFilters]);
  const top = queue[0];
  useEffect(() => {
    useDeckState.setState({ pinnedId: top?.id ?? null });
  }, [top?.id]);

  // The details screen was swiped: fly that card off the deck as if it had been swiped here.
  const swipeRequest = useDeckState((s) => s.swipeRequest);
  useEffect(() => {
    if (!swipeRequest) return;
    useDeckState.setState({ swipeRequest: null });
    if (top?.id === swipeRequest.id) deckRef.current?.swipe(swipeRequest.d);
    else recordDecision(swipeRequest.id, swipeRequest.d);
  }, [swipeRequest, top?.id]);

  const deckDetails = useDeckState((s) => s.deckDetails);
  const detailsPlaying = useDeckState((s) => s.detailsPlaying);
  // The details screen opened from the deck covers it, so keep the preview going unless the user plays something there.
  const audio = useDeckAudio(top, queue.slice(1, 3), (focused || (deckDetails && !detailsPlaying)) && active);
  const previewsByShow = usePreviewStore((s) => s.byShow);

  // Fade the preview out as the card is dragged toward a decision.
  useAnimatedReaction(
    () => Math.round(Math.abs(drag.value) * 10) / 10,
    (v, prev) => {
      if (v !== prev) scheduleOnRN(audio.setVolume, 1 - v * 0.85);
    },
    [audio.setVolume],
  );

  const onDecide = (show: Show, d: Decision) => {
    audio.stop();
    setEnterFrom(null);
    recordDecision(show.id, d);
  };

  const onUndo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const was = decisionsRec[last]?.decision;
    setEnterFrom({ id: last, side: was === 'going' ? 'right' : 'left' });
    useDeckState.setState({ pinnedId: last });
    useApp.getState().undo();
    if (was === 'going') syncReminders();
  };

  const nFilters = activeFilterCount(filters, DEFAULT_FILTERS);
  const toggleWhen = (w: 'tonight' | 'weekend') => setFilters({ when: filters.when === w ? 'week' : w });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.logo}>
          PULL UP<Text style={{ color: C.accent }}>.</Text>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          {communityEnabled ? (
            <Pressable
              onPress={() => router.push('/community')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Add or confirm shows">
              <Ionicons name="add-circle-outline" size={24} color={C.muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={22} color={C.muted} />
          </Pressable>
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label="Filters"
            badge={nFilters || undefined}
            onPress={() => router.push('/filters')}
            icon={<Ionicons name="options-outline" size={15} color={C.text} />}
          />
          <Chip
            label={filters.place ? `${filters.place.source === 'device' ? 'Near me' : filters.place.label} · ${filters.radiusMi} mi` : 'Location'}
            onPress={() => router.push({ pathname: '/filters', params: { focus: 'where' } })}
            icon={<Ionicons name="location-outline" size={15} color={C.text} />}
          />
          <Chip label="Tonight" on={filters.when === 'tonight'} onPress={() => toggleWhen('tonight')} />
          <Chip label="This weekend" on={filters.when === 'weekend'} onPress={() => toggleWhen('weekend')} />
          {priceUi ? (
            <Chip
              label="Free"
              on={filters.price === 'free'}
              onPress={() => setFilters({ price: filters.price === 'free' ? 'any' : 'free' })}
            />
          ) : null}
          <Chip
            label={filters.genres.length ? `Genre · ${filters.genres.length}` : 'Genre'}
            on={filters.genres.length > 0}
            onPress={() => router.push({ pathname: '/filters', params: { focus: 'genre' } })}
          />
        </ScrollView>
      </View>

      <View style={styles.deckArea} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size.w > 0 && queue.length > 0 ? (
          <Deck
            ref={deckRef}
            queue={queue}
            width={size.w}
            height={size.h}
            drag={drag}
            enterFrom={enterFrom}
            onDecide={onDecide}
            onOpen={(s) => {
              useDeckState.setState({ deckDetails: true, detailsPlaying: false });
              router.push(`/show/${s.id}`);
            }}
            renderAudio={(show, isTop) => {
              if (!deezerOn) return null; // Deezer is switched off: no audio bar, no error text
              if (isTop) {
                return (
                  <AudioBar
                    interactive
                    loading={audio.loading}
                    current={audio.current}
                    index={audio.index}
                    count={audio.playable.length}
                    playing={audio.playing}
                    progress={audio.progress}
                    onToggle={audio.toggle}
                    onNext={audio.nextAct}
                    onWrongArtist={audio.wrongArtist}
                  />
                );
              }
              const p = previewsByShow[show.id];
              const list = playableActs(p);
              return (
                <AudioBar
                  interactive={false}
                  loading={!p || p.state === 'loading'}
                  current={list[0]}
                  index={0}
                  count={list.length}
                  playing={false}
                  progress={0}
                />
              );
            }}
          />
        ) : null}
        {size.w > 0 && !filters.place ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Finding shows near you…</Text>
          </View>
        ) : null}
        {size.w > 0 && filters.place && filters.place.metro && !feeds[filters.place.metro] ? (
          <NoListings loading={listingsRefreshing} error={listingsError} />
        ) : null}
        {size.w > 0 && filters.place && (!filters.place.metro || feeds[filters.place.metro]) && queue.length === 0 ? (
          filters.place.metro && feeds[filters.place.metro].shows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No listings here yet</Text>
              <Text style={styles.emptyBody}>The listings provider has no upcoming shows for this city. Try another city in Filters.</Text>
              {communityEnabled ? (
                <Pressable style={styles.emptyButton} onPress={() => router.push('/community')}>
                  <Text style={styles.emptyButtonText}>Add a show</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
          <EmptyDeck
            filtered={nFilters > 0}
            when={filters.when}
            onWiden={() => setFilters({ when: filters.when === 'month' ? 'all' : 'month' })}
            onClear={resetFilters}
          />
          )
        ) : null}
      </View>

      <View style={styles.actions}>
        <RoundButton
          icon="close"
          label="Pass"
          size={62}
          disabled={!top}
          onPress={() => deckRef.current?.swipe('passed')}
        />
        <RoundButton icon="arrow-undo" label="Undo" size={46} disabled={history.length === 0} onPress={onUndo} />
        <RoundButton
          icon="heart"
          label="Going"
          size={62}
          accent
          disabled={!top}
          onPress={() => deckRef.current?.swipe('going')}
        />
      </View>
    </SafeAreaView>
  );
}

function RoundButton(p: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  size: number;
  accent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      style={({ pressed }) => [
        styles.round,
        {
          width: p.size,
          height: p.size,
          borderRadius: p.size / 2,
          backgroundColor: p.accent ? C.accent : C.surface,
          borderColor: p.accent ? C.accent : C.line,
          opacity: p.disabled ? 0.35 : pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}>
      <Ionicons name={p.icon} size={p.size * 0.42} color={p.accent ? C.accentInk : C.text} />
    </Pressable>
  );
}

/** Nothing downloaded yet: first launch before the feed arrives, or no connection. */
function NoListings(p: { loading: boolean; error: string | null }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{p.loading || !p.error ? 'Loading shows…' : "Couldn't load shows"}</Text>
      <Text style={styles.emptyBody}>
        {p.loading || !p.error
          ? 'Getting this week’s listings.'
          : `${p.error}. Check your connection and try again.`}
      </Text>
      {!p.loading ? (
        <Pressable style={styles.emptyButton} onPress={() => useListings.getState().refresh({ force: true })}>
          <Text style={styles.emptyButtonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyDeck(p: { filtered: boolean; when: string; onWiden: () => void; onClear: () => void }) {
  const canWiden = p.when !== 'all';
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{p.filtered ? 'No shows match these filters' : "You're through every show"}</Text>
      <Text style={styles.emptyBody}>
        {p.filtered || canWiden
          ? `Showing ${WHEN_LABELS[p.when as keyof typeof WHEN_LABELS].toLowerCase()}.`
          : 'New shows appear here as listings are refreshed.'}
      </Text>
      {canWiden ? (
        <Pressable style={styles.emptyButton} onPress={p.onWiden}>
          <Text style={styles.emptyButtonText}>
            {p.when === 'month' ? 'Show all upcoming' : 'Widen to next 30 days'}
          </Text>
        </Pressable>
      ) : null}
      {p.filtered ? (
        <Pressable onPress={p.onClear} hitSlop={8}>
          <Text style={styles.emptyLink}>Clear all filters</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  logo: { fontFamily: F.poster, color: C.text, fontSize: 28, letterSpacing: 1 },
  chipRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  deckArea: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingVertical: 10 },
  round: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 20, textAlign: 'center' },
  emptyBody: { fontFamily: F.uiRegular, color: C.muted, fontSize: 14, textAlign: 'center' },
  emptyButton: { marginTop: 8, backgroundColor: C.text, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
  emptyButtonText: { fontFamily: F.uiBold, color: C.bg, fontSize: 14 },
  emptyLink: { fontFamily: F.ui, color: C.muted, fontSize: 14, textDecorationLine: 'underline', marginTop: 6 },
});
