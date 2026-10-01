import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C, F } from '@/constants/theme';
import { cityPlace } from '@/lib/location';
import { METROS, normalizeSearch } from '@/lib/metros';
import { useApp } from '@/lib/store';

/** Every city the listings cover, with a search box. */
export default function CitiesScreen() {
  const current = useApp((s) => s.filters.place);
  const setFilters = useApp((s) => s.setFilters);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = normalizeSearch(q);
    return [...METROS]
      .filter((m) => !needle || normalizeSearch(`${m.name} ${m.state}`).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q]);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        placeholder="Search cities"
        placeholderTextColor={C.faint}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search cities"
      />
      <FlatList
        data={list}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.none}>No listed city matches “{q}”.</Text>}
        renderItem={({ item: m }) => {
          const on = current?.source === 'city' && current.metro === m.id;
          return (
            <Pressable
              style={styles.row}
              accessibilityRole="button"
              onPress={() => {
                setFilters({ place: cityPlace(m) });
                router.back();
              }}>
              <Text style={[styles.name, on && { color: C.accent }]}>{m.name}</Text>
              <Text style={styles.state}>{m.state}</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  search: {
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    color: C.text,
    fontFamily: F.uiRegular,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  name: { fontFamily: F.ui, color: C.text, fontSize: 16 },
  state: { fontFamily: F.monoBold, color: C.faint, fontSize: 12 },
  none: { fontFamily: F.uiRegular, color: C.muted, padding: 20, textAlign: 'center' },
});
