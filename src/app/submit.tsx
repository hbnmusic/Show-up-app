import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/Chip';
import { SignIn } from '@/components/SignIn';
import { C, F } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { submitShow } from '@/lib/community/api';
import { buildPayload, EMPTY_FORM, extractUrl, rowToShow, type SubmitForm } from '@/lib/community/form';
import { dedupeKey } from '@/lib/listings/merge';
import { useListings } from '@/lib/listingsStore';
import { DEFAULT_METRO, METROS, metroById, normalizeSearch } from '@/lib/metros';
import { AGE_LABELS } from '@/lib/showText';
import { useApp } from '@/lib/store';
import { communityEnabled } from '@/lib/communityConfig';
import { ALL_GENRES, type AgePolicy, type Genre } from '@/lib/types';

const AGES: AgePolicy[] = ['unknown', 'all_ages', '18_plus', '21_plus'];

export default function SubmitScreen() {
  const { url, text } = useLocalSearchParams<{ url?: string; text?: string }>();
  const userId = useAuth((s) => s.userId);
  const placeMetro = useApp((s) => s.filters.place?.metro) ?? DEFAULT_METRO.id;
  const known = useListings((s) => s.shows);
  const [form, setForm] = useState<SubmitForm>({ ...EMPTY_FORM, metro: placeMetro, sourceUrl: url ?? '' });
  const [cityQuery, setCityQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof SubmitForm>(k: K, v: SubmitForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const metro = metroById(form.metro);

  const cityMatches = useMemo(() => {
    const needle = normalizeSearch(cityQuery);
    return needle ? METROS.filter((m) => normalizeSearch(`${m.name} ${m.state}`).includes(needle)).slice(0, 5) : [];
  }, [cityQuery]);

  if (!communityEnabled) {
    return (
      <View style={styles.screen}>
        <Text style={styles.note}>Community listings are not set up in this build.</Text>
      </View>
    );
  }
  if (!userId) {
    return (
      <View style={styles.screen}>
        <SignIn />
      </View>
    );
  }

  const pasteLink = async () => {
    const link = extractUrl(await Clipboard.getStringAsync());
    if (link) set('sourceUrl', link);
    else Alert.alert('No link found', 'Copy the post or ticket link first, then tap Paste.');
  };

  const send = async () => {
    const now = new Date();
    const built = buildPayload(form, { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    if (!built.ok) return setErrors(built.errors);
    setErrors([]);

    // Already in the provider's listings (or someone's confirmed one)? Do not add it twice.
    const draft = rowToShow({
      id: 'draft',
      created_by: '',
      created_at: now.toISOString(),
      status: 'pending',
      metro: built.payload.metro,
      title: built.payload.title,
      acts: built.payload.acts,
      venue_name: built.payload.venue_name,
      venue_area: built.payload.venue_area,
      venue_address: null,
      starts_local: built.payload.starts_local,
      utc_offset_min: 0,
      price_min: null,
      price_max: null,
      is_free: false,
      age_policy: 'unknown',
      genres: [],
      ticket_url: null,
      source_url: null,
      confirm_count: 0,
      report_count: 0,
    });
    if (draft) {
      const key = dedupeKey(draft);
      if (known.some((s) => dedupeKey(s) === key)) {
        return setErrors(['That show is already listed (same night, venue and headliner).']);
      }
    }

    setBusy(true);
    const res = await submitShow(built.payload);
    setBusy(false);
    if (!res.ok) return setErrors([res.error]);
    await useListings.getState().refreshCommunity([built.payload.metro]);
    const r = res.data;
    Alert.alert(
      r.result === 'confirmed' ? 'Already added' : r.status === 'live' ? 'Your show is live' : 'Thanks, show added',
      r.result === 'confirmed'
        ? 'Someone had already added this show. Your submission confirmed it, so it is live now.'
        : r.status === 'live'
          ? 'It is listed for everyone.'
          : 'It becomes visible to everyone once a second person confirms it.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {text && extractUrl(text) !== text.trim() ? (
          <View style={styles.shared}>
            <Text style={styles.sharedLabel}>FROM YOUR SHARE</Text>
            <Text style={styles.sharedText} selectable numberOfLines={6}>
              {text}
            </Text>
          </View>
        ) : null}

        <Field label="BANDS (headliner first, separated by commas)">
          <TextInput style={styles.input} value={form.acts} onChangeText={(v) => set('acts', v)} placeholder="Headliner, Support, Opener" placeholderTextColor={C.faint} accessibilityLabel="Bands" />
        </Field>
        <Field label="NAME OF THE NIGHT (optional)">
          <TextInput style={styles.input} value={form.title} onChangeText={(v) => set('title', v)} placeholder="Festival or party name" placeholderTextColor={C.faint} accessibilityLabel="Event name" />
        </Field>
        <Field label="VENUE">
          <TextInput style={styles.input} value={form.venueName} onChangeText={(v) => set('venueName', v)} placeholder="Venue name" placeholderTextColor={C.faint} accessibilityLabel="Venue" />
        </Field>
        <Field label="CITY">
          <Text style={styles.cityNow}>
            {metro ? `${metro.name}, ${metro.state}` : 'Choose a city'}
          </Text>
          <TextInput
            style={styles.input}
            value={cityQuery}
            onChangeText={setCityQuery}
            placeholder="Search to change the city"
            placeholderTextColor={C.faint}
            autoCorrect={false}
            accessibilityLabel="Search cities"
          />
          {cityMatches.map((m) => (
            <Pressable
              key={m.id}
              style={styles.match}
              onPress={() => {
                set('metro', m.id);
                setCityQuery('');
              }}>
              <Text style={styles.matchText}>
                {m.name}, {m.state}
              </Text>
            </Pressable>
          ))}
        </Field>
        <Field label="NEIGHBORHOOD OR TOWN">
          <TextInput style={styles.input} value={form.area} onChangeText={(v) => set('area', v)} placeholder="Bushwick" placeholderTextColor={C.faint} accessibilityLabel="Neighborhood or town" />
        </Field>
        <Field label="STREET ADDRESS (optional)">
          <TextInput style={styles.input} value={form.address} onChangeText={(v) => set('address', v)} placeholder="Public venues only" placeholderTextColor={C.faint} accessibilityLabel="Street address" />
        </Field>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Field label="DATE">
              <TextInput style={styles.input} value={form.date} onChangeText={(v) => set('date', v)} placeholder="Oct 24" placeholderTextColor={C.faint} accessibilityLabel="Date" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="START TIME">
              <TextInput style={styles.input} value={form.time} onChangeText={(v) => set('time', v)} placeholder="8pm" placeholderTextColor={C.faint} autoCapitalize="none" accessibilityLabel="Start time" />
            </Field>
          </View>
        </View>

        <Field label="PRICE">
          <View style={styles.freeRow}>
            <Text style={styles.freeLabel}>Free</Text>
            <Switch value={form.free} onValueChange={(v) => set('free', v)} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.text} accessibilityLabel="Free show" />
          </View>
          {!form.free ? (
            <TextInput style={styles.input} value={form.price} onChangeText={(v) => set('price', v)} placeholder="20 or 15-25 (optional)" placeholderTextColor={C.faint} keyboardType="numbers-and-punctuation" accessibilityLabel="Price" />
          ) : null}
        </Field>

        <Field label="AGES">
          <View style={styles.chips}>
            {AGES.map((a) => (
              <Chip key={a} label={a === 'unknown' ? "Don't know" : AGE_LABELS[a]} on={form.age === a} onPress={() => set('age', a)} />
            ))}
          </View>
        </Field>

        <Field label="GENRE (up to 3, optional)">
          <View style={styles.chips}>
            {ALL_GENRES.map((g: Genre) => {
              const on = form.genres.includes(g);
              return (
                <Chip
                  key={g}
                  label={g}
                  on={on}
                  onPress={() => set('genres', on ? form.genres.filter((x) => x !== g) : form.genres.length < 3 ? [...form.genres, g] : form.genres)}
                />
              );
            })}
          </View>
        </Field>

        <Field label="TICKET LINK (optional)">
          <TextInput style={styles.input} value={form.ticketUrl} onChangeText={(v) => set('ticketUrl', v)} placeholder="https://" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Ticket link" />
        </Field>
        <Field label="WHERE YOU SAW IT (post or event link)">
          <TextInput style={styles.input} value={form.sourceUrl} onChangeText={(v) => set('sourceUrl', v)} placeholder="https://instagram.com/p/…" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Post link" />
          <Pressable onPress={pasteLink} hitSlop={8}>
            <Text style={styles.paste}>Paste copied link</Text>
          </Pressable>
        </Field>

        {errors.map((e) => (
          <Text key={e} style={styles.err}>
            {e}
          </Text>
        ))}
        <Pressable style={styles.send} onPress={send} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={styles.sendText}>Add this show</Text>}
        </Pressable>
        <Text style={styles.note}>
          Pull Up cannot read the flyer from a shared post, so type in the details. A second person has to confirm the
          show before it appears for everyone. Posting the same show twice, or posting spam, gets an account blocked.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  label: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.2 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    color: C.text,
    fontFamily: F.uiRegular,
    fontSize: 16,
  },
  pair: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityNow: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  match: { paddingVertical: 10, paddingHorizontal: 6 },
  matchText: { fontFamily: F.ui, color: C.accent, fontSize: 15 },
  freeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  freeLabel: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  paste: { fontFamily: F.ui, color: C.muted, fontSize: 13, textDecorationLine: 'underline' },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
  send: { height: 50, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  sendText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 16 },
  note: { fontFamily: F.uiRegular, color: C.faint, fontSize: 12, lineHeight: 17, padding: 4 },
  shared: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12, gap: 4 },
  sharedLabel: { fontFamily: F.monoBold, color: C.faint, fontSize: 10, letterSpacing: 1.2 },
  sharedText: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13 },
});
