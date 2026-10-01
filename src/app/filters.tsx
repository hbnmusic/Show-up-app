import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { C, F } from '@/constants/theme';
import { buildQueue, WHEN_LABELS } from '@/lib/filters';
import { useListings } from '@/lib/listingsStore';
import { useApp } from '@/lib/store';
import { detectPlace } from '@/lib/location';
import { metroById } from '@/lib/metros';
import { RADIUS_OPTIONS, type AgeFilter, type Decision, type Genre, type PriceFilter, type VenueType, type WhenFilter } from '@/lib/types';

const WHEN: WhenFilter[] = ['tonight', 'tomorrow', 'weekend', 'week', 'month', 'all'];
const VENUES: { value: VenueType; label: string }[] = [
  { value: 'house', label: 'House & basement' },
  { value: 'diy', label: 'DIY spaces' },
  { value: 'venue', label: 'Venues & clubs' },
];
const PRICES: { value: PriceFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'free', label: 'Free' },
  { value: 'under10', label: '$10 or less' },
  { value: 'under20', label: '$20 or less' },
];
const AGES: { value: AgeFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'all_ages', label: 'All ages only' },
  { value: '18_plus', label: '18+ or all ages' },
];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function FiltersScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const resetFilters = useApp((s) => s.resetFilters);
  const decisionsRec = useApp((s) => s.decisions);
  const allShows = useListings((s) => s.shows);
  const ageKnown = useMemo(() => allShows.some((s) => s.agePolicy !== 'unknown'), [allShows]);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const useMyLocation = async () => {
    setLocating(true);
    setLocNote(null);
    const r = await detectPlace();
    setLocating(false);
    if (!r.ok) {
      setLocNote(
        r.reason === 'denied'
          ? 'Location is off for Pull Up. Turn it on in your phone settings, or pick a city.'
          : "Couldn't get a location fix. Pick a city instead.",
      );
      return;
    }
    setFilters({ place: r.place });
    if (!r.covered) {
      setLocNote(`You're ${Math.round(r.miles)} miles from ${r.nearest.name}, the closest city with listings, so that is what you're seeing.`);
    }
  };
  // Genres present in the listings, most common first.
  const genreList = useMemo(() => {
    const counts = new Map<Genre, number>();
    for (const sh of allShows) for (const g of sh.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([g]) => g);
  }, [allShows]);
  const scroll = useRef<ScrollView>(null);
  const [genreY, setGenreY] = useState<number | null>(null);
  const [whereY, setWhereY] = useState<number | null>(null);

  useEffect(() => {
    if (focus === 'genre' && genreY != null) scroll.current?.scrollTo({ y: genreY - 8, animated: true });
    if (focus === 'where' && whereY != null) scroll.current?.scrollTo({ y: whereY - 8, animated: true });
  }, [focus, genreY, whereY]);

  const count = useMemo(() => {
    const d: Record<string, Decision> = {};
    for (const [id, r] of Object.entries(decisionsRec)) d[id] = r.decision;
    return buildQueue(allShows, filters, d, new Date()).length;
  }, [allShows, filters, decisionsRec]);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <Section title="When">
          {WHEN.map((w) => (
            <Chip key={w} label={WHEN_LABELS[w]} on={filters.when === w} onPress={() => setFilters({ when: w })} />
          ))}
        </Section>
        <View onLayout={(e) => setWhereY(e.nativeEvent.layout.y)}>
          <Section title="Where" hint={locNote ?? (filters.place ? `Within ${filters.radiusMi} miles of ${filters.place.label}` : undefined)}>
            <Chip
              label={locating ? 'Locating…' : 'Near me'}
              on={filters.place?.source === 'device'}
              onPress={useMyLocation}
            />
            {filters.place?.source === 'city' ? (
              <Chip label={filters.place.label} on onPress={() => router.push('/cities')} />
            ) : null}
            <Chip label={filters.place?.source === 'city' ? 'Change city' : 'Choose a city'} onPress={() => router.push('/cities')} />
          </Section>
          <Section title="Distance" hint={`Listings cover about 25 miles around ${filters.place ? (metroById(filters.place.metro)?.name ?? 'each city') : 'each city'}`}>
            {RADIUS_OPTIONS.map((r) => (
              <Chip key={r} label={`${r} mi`} on={filters.radiusMi === r} onPress={() => setFilters({ radiusMi: r })} />
            ))}
          </Section>
        </View>
        <Section title="Venue type">
          {VENUES.map((v) => (
            <Chip
              key={v.value}
              label={v.label}
              on={filters.venueTypes.includes(v.value)}
              onPress={() => setFilters({ venueTypes: toggle(filters.venueTypes, v.value) })}
            />
          ))}
        </Section>
        <View onLayout={(e) => setGenreY(e.nativeEvent.layout.y)}>
          <Section title="Genre" hint={filters.genres.length ? `${filters.genres.length} picked` : 'Any'}>
            {[...new Set([...genreList, ...filters.genres])].map((g) => (
              <Chip
                key={g}
                label={g}
                on={filters.genres.includes(g)}
                onPress={() => setFilters({ genres: toggle(filters.genres, g) })}
              />
            ))}
          </Section>
        </View>
        <Section title="Price" hint="Shows with no listed price only appear under Any">
          {PRICES.map((p) => (
            <Chip key={p.value} label={p.label} on={filters.price === p.value} onPress={() => setFilters({ price: p.value })} />
          ))}
        </Section>
        {ageKnown ? (
          <Section title="Age" hint="Shows with no listed age policy only appear under Any">
            {AGES.map((a) => (
              <Chip key={a.value} label={a.label} on={filters.age === a.value} onPress={() => setFilters({ age: a.value })} />
            ))}
          </Section>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable onPress={resetFilters} hitSlop={8} accessibilityRole="button">
          <Text style={styles.reset}>Reset</Text>
        </Pressable>
        <Pressable style={styles.apply} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.applyText}>{count === 1 ? 'Show 1 show' : `Show ${count} shows`}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 22, paddingBottom: 32 },
  section: { gap: 10 },
  sectionHead: { gap: 2 },
  sectionTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  hint: { fontFamily: F.uiRegular, color: C.faint, fontSize: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  reset: { fontFamily: F.ui, color: C.muted, fontSize: 15, textDecorationLine: 'underline' },
  apply: { backgroundColor: C.accent, paddingHorizontal: 22, height: 46, borderRadius: 999, justifyContent: 'center' },
  applyText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
});
