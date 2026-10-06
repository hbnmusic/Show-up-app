import { Alert, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { C, F } from '@/constants/theme';
import { isCommunityFeed, useListings } from '@/lib/listingsStore';
import { ensureNotificationPermission, notificationsAllowed, syncReminders } from '@/lib/reminders';
import { sendTestNotifications, setRetentionToggle, syncRetentionTask, type TestResult } from '@/lib/retention/service';
import { cancelRetentionNotifications } from '@/lib/retention/cancel';
import { useRetention } from '@/lib/retention/store';
import { resetGoing, setIncludeInCounts } from '@/lib/going/service';
import { useGoing } from '@/lib/going/store';
import { metroById } from '@/lib/metros';
import { useApp } from '@/lib/store';
import { communityEnabled } from '@/lib/communityConfig';
import { analyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics';
import { useFlag } from '@/lib/flags';
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import type { ReminderPrefs } from '@/lib/types';

export default function SettingsScreen() {
  const deezerOn = useFlag('deezer_enabled');
  const prefs = useApp((s) => s.reminderPrefs);
  const setPrefs = useApp((s) => s.setReminderPrefs);
  const autoplay = useApp((s) => s.autoplay);
  const setAutoplay = useApp((s) => s.setAutoplay);
  const [allowed, setAllowed] = useState(true);
  const notifOn = useFlag('notifications_enabled');
  const includeGoing = useGoing((s) => s.include);
  const typeA = useRetention((s) => s.typeA);
  const typeB = useRetention((s) => s.typeB);
  const placeMetro = useApp((s) => s.filters.place?.metro);
  const cityNotifs = metroById(placeMetro)?.notificationsEnabled ?? false;
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const { shows, source, generatedAt, attribution, refreshing, error } = useListings();
  const cities = useListings((s) => Object.keys(s.feeds).filter((id) => !isCommunityFeed(id)).length);

  useEffect(() => {
    notificationsAllowed().then(setAllowed);
    analyticsEnabled().then(setAnalyticsOn);
  }, []);

  const update = async (p: Partial<ReminderPrefs>) => {
    setPrefs(p);
    await syncReminders();
  };

  const askPermission = async () => {
    const ok = await ensureNotificationPermission();
    setAllowed(ok);
    if (ok) {
      syncReminders();
      syncRetentionTask().catch(() => {});
    } else if (Platform.OS !== 'web') Linking.openSettings().catch(() => {});
  };

  const runTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      if (!(await notificationsAllowed()) && !(await ensureNotificationPermission())) {
        setAllowed(false);
        setTestNote('Notifications are off for Come Thru. Turn them on in your phone settings to get a test.');
        return;
      }
      setAllowed(true);
      const r: TestResult = await sendTestNotifications();
      setTestNote(
        r.ok
          ? 'Two test notifications are on their way (in a few seconds). Put the app in the background to see them.'
          : r.reason === 'switched_off'
            ? 'Notifications are paused for everyone at the moment, so no test was sent.'
            : r.reason === 'city_off'
              ? 'These notifications are not on for your city yet, so no test was sent.'
              : r.reason === 'no_city'
                ? 'Pick a city first, then try again.'
                : 'Notifications are off for Come Thru. Turn them on in your phone settings to get a test.',
      );
    } finally {
      setTesting(false);
    }
  };

  const confirmReset = () =>
    Alert.alert('Reset Come Thru?', 'This clears your Going list, passes, filters and settings on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          useApp.getState().resetAll();
          useRetention.getState().reset();
          resetGoing();
          await cancelRetentionNotifications();
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
          <Text style={styles.bannerText}>Notifications are off for Come Thru. Tap to turn them on.</Text>
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

      <Text style={styles.section}>NOTIFICATIONS</Text>
      <View style={styles.card}>
        <Toggle
          label="New shows in your city"
          detail="“5 new shows just added in New York, check them out!” At most once every two days, in the early evening"
          value={typeA}
          onChange={(v) => setRetentionToggle('A', v)}
        />
        <View style={styles.divider} />
        <Toggle
          label="Shows tonight"
          detail="“4 Rock shows tonight near you, check them out!” At most once a day, in the late afternoon"
          value={typeB}
          onChange={(v) => setRetentionToggle('B', v)}
        />
        <View style={styles.divider} />
        <Pressable style={styles.refreshRow} disabled={testing} onPress={runTest} accessibilityRole="button">
          <Text style={[styles.label, testing && { color: C.faint }]}>{testing ? 'Sending…' : 'Send me a test notification'}</Text>
          <Text style={styles.detail}>Uses the real wording and the numbers for your city right now</Text>
        </Pressable>
        {Platform.OS !== 'web' ? (
          <>
            <View style={styles.divider} />
            <Pressable style={styles.refreshRow} onPress={() => Linking.openSettings().catch(() => {})} accessibilityRole="button">
              <Text style={styles.label}>Open phone notification settings</Text>
              <Text style={styles.detail}>Change or silence each kind of notification there too</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {testNote ? <Text style={styles.help}>{testNote}</Text> : null}
      {!notifOn ? <Text style={styles.help}>These notifications are paused for everyone right now.</Text> : null}
      {notifOn && !cityNotifs ? <Text style={styles.help}>These two notifications are not on for your city yet.</Text> : null}
      <Text style={styles.help}>
        Come Thru makes these on your phone from the listings it already downloaded; nothing about you is sent anywhere to make them. They are best effort: your phone decides when apps may run in the background, so one can arrive late or not at all, especially with battery saving on. No more than one a day, none at night, and they stop for two weeks if you ignore several in a row.
      </Text>

      <Text style={styles.section}>LISTINGS</Text>
      <View style={styles.card}>
        <Text style={styles.about}>
          {source === 'none'
            ? 'No listings downloaded yet.'
            : `${shows.length} shows from ${cities} ${cities === 1 ? 'city' : 'cities'}${generatedAt ? `, updated ${new Date(generatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}${source === 'cache' ? ' (saved copy)' : ''}.`}
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

      {communityEnabled ? (
        <>
          <Text style={styles.section}>COMMUNITY</Text>
          <View style={styles.card}>
            <Pressable style={styles.refreshRow} onPress={() => router.push('/community')} accessibilityRole="button">
              <Text style={styles.label}>Add or confirm shows</Text>
              <Text style={styles.detail}>Add a show the listings missed, confirm one, manage blocks, or delete your account</Text>
            </Pressable>
            <Pressable style={styles.refreshRow} onPress={() => router.push('/flyers')} accessibilityRole="button">
              <Text style={styles.label}>My flyers</Text>
              <Text style={styles.detail}>Status of flyers you shared from Instagram or your gallery, and flyers waiting for a second person to confirm</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <Text style={styles.section}>PRIVACY AND FEEDBACK</Text>
      <View style={styles.card}>
        <Toggle
          label="Include my Going in public counts"
          detail="Counts are anonymous, only shown above 15, and removed a week after the show."
          value={includeGoing}
          onChange={setIncludeInCounts}
        />
        <View style={styles.divider} />
        {communityEnabled ? (
          <>
            <Toggle
              label="Share anonymous usage data"
              detail="Which screens are used and how often. No name, email, location or show details. Turning it off also deletes what was sent."
              value={analyticsOn}
              onChange={(v) => {
                setAnalyticsOn(v);
                setAnalyticsEnabled(v);
              }}
            />
            <View style={styles.divider} />
            <Pressable style={styles.refreshRow} onPress={() => router.push('/feedback')} accessibilityRole="button">
              <Text style={styles.label}>Send feedback or report a bug</Text>
              <Text style={styles.detail}>Goes straight to the developer</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.about}>Usage data and feedback are not set up in this build.</Text>
        )}
      </View>

      <Text style={styles.section}>ABOUT</Text>
      <View style={styles.card}>
        <Pressable style={styles.refreshRow} onPress={() => router.push('/about')} accessibilityRole="button">
          <Text style={styles.label}>About, credits and support</Text>
          <Text style={styles.detail}>Data sources, image credits and contact</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.refreshRow} onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
          <Text style={styles.label}>Privacy Policy</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.refreshRow} onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
          <Text style={styles.label}>Terms of Use</Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        Flyers without a promoter image are generated. Genre tags come from the listings providers and are broad.
        {deezerOn ? 'Previews come from the Deezer public API, which allows non-commercial use only.' : ''}
      </Text>

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
