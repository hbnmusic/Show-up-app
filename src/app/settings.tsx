import { Alert, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { useEffect, useState } from 'react';

import { C, F } from '@/constants/theme';
import { useListings } from '@/lib/listingsStore';
import { ensureNotificationPermission, notificationsAllowed, syncReminders } from '@/lib/reminders';
import { useApp } from '@/lib/store';
import type { ReminderPrefs } from '@/lib/types';

export default function SettingsScreen() {
  const prefs = useApp((s) => s.reminderPrefs);
  const setPrefs = useApp((s) => s.setReminderPrefs);
  const autoplay = useApp((s) => s.autoplay);
  const setAutoplay = useApp((s) => s.setAutoplay);
  const [allowed, setAllowed] = useState(true);
  const { shows, source, generatedAt, attribution, refreshing, error } = useListings();

  useEffect(() => {
    notificationsAllowed().then(setAllowed);
  }, []);

  const update = async (p: Partial<ReminderPrefs>) => {
    setPrefs(p);
    await syncReminders();
  };

  const askPermission = async () => {
    const ok = await ensureNotificationPermission();
    setAllowed(ok);
    if (ok) syncReminders();
    else if (Platform.OS !== 'web') Linking.openSettings().catch(() => {});
  };

  const confirmReset = () =>
    Alert.alert('Reset Pull Up?', 'This clears your Going list, passes, filters and settings on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          useApp.getState().resetAll();
          await syncReminders();
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>PREVIEWS</Text>
      <View style={styles.card}>
        <Toggle
          label="Autoplay previews"
          detail="Play each card's preview as soon as it reaches the top"
          value={autoplay}
          onChange={setAutoplay}
        />
      </View>

      <Text style={styles.section}>REMINDERS</Text>
      {!allowed && Platform.OS !== 'web' ? (
        <Pressable style={styles.banner} onPress={askPermission}>
          <Text style={styles.bannerText}>Notifications are off for Pull Up. Tap to turn them on.</Text>
        </Pressable>
      ) : null}
      <View style={styles.card}>
        <Toggle
          label="Day of the show"
          detail="Noon on show day"
          value={prefs.dayOf}
          onChange={(v) => update({ dayOf: v })}
        />
        <View style={styles.divider} />
        <Toggle
          label="Before doors"
          detail="One hour before doors"
          value={prefs.beforeDoors}
          onChange={(v) => update({ beforeDoors: v })}
        />
        <View style={styles.divider} />
        <Toggle
          label="Day before"
          detail="6 PM the evening before"
          value={prefs.dayBefore}
          onChange={(v) => update({ dayBefore: v })}
        />
      </View>
      <Text style={styles.help}>
        These apply to every show you mark going. Turn reminders off for a single show from its detail page.
      </Text>

      <Text style={styles.section}>LISTINGS</Text>
      <View style={styles.card}>
        <Text style={styles.about}>
          {source === 'none'
            ? 'No listings downloaded yet.'
            : `${shows.length} shows${generatedAt ? `, updated ${new Date(generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}${source === 'cache' ? ' (saved copy)' : ''}.`}
          {attribution.length ? `\n${attribution.join('\n')}` : ''}
        </Text>
        {error ? <Text style={styles.listError}>Last refresh failed: {error}</Text> : null}
        <View style={styles.divider} />
        <Pressable
          style={styles.refreshRow}
          disabled={refreshing}
          onPress={() => useListings.getState().refresh({ force: true }).then(async (ok) => {
              if (ok) await syncReminders();
            })}
          accessibilityRole="button">
          <Text style={[styles.label, refreshing && { color: C.faint }]}>{refreshing ? 'Refreshing…' : 'Refresh listings now'}</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>ABOUT THIS BUILD</Text>
      <View style={styles.card}>
        <Text style={styles.about}>
          Prototype. Flyers are generated placeholders, not promoter artwork. Genre tags come from the listings
          provider and are broad. Previews come from the Deezer public API, which allows non-commercial use only.
        </Text>
      </View>

      <Pressable style={styles.reset} onPress={confirmReset}>
        <Text style={styles.resetText}>Reset all data on this phone</Text>
      </Pressable>
    </ScrollView>
  );
}

function Toggle(p: { label: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{p.label}</Text>
        <Text style={styles.detail}>{p.detail}</Text>
      </View>
      <Switch
        value={p.value}
        onValueChange={p.onChange}
        trackColor={{ true: C.accent, false: C.line }}
        thumbColor={C.text}
        accessibilityLabel={p.label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  section: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.5, marginTop: 12 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  label: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  detail: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 14 },
  help: { fontFamily: F.uiRegular, color: C.faint, fontSize: 12, lineHeight: 17 },
  banner: { backgroundColor: '#3A2A0A', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.warn },
  bannerText: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
  about: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, lineHeight: 19, padding: 14 },
  listError: { fontFamily: F.uiRegular, color: C.warn, fontSize: 12, paddingHorizontal: 14, paddingBottom: 12 },
  refreshRow: { paddingHorizontal: 14, paddingVertical: 14 },
  reset: { marginTop: 20, alignItems: 'center', padding: 12 },
  resetText: { fontFamily: F.ui, color: C.danger, fontSize: 14 },
});
