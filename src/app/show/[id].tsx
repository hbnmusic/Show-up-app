import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlyerArt } from '@/components/FlyerArt';
import { C, F } from '@/constants/theme';
import { addToCalendar } from '@/lib/calendar';
import { recordDecision, removeDecision } from '@/lib/decide';
import { useListings } from '@/lib/listingsStore';
import { resolveShow, useShowPreviews, type ActPreview } from '@/lib/previews';
import { notificationsAllowed, syncReminders } from '@/lib/reminders';
import {
  AGE_LABELS,
  VENUE_TYPE_LABELS,
  calendarLocation,
  priceLabel,
  showTitle,
  timeLabel,
} from '@/lib/showText';
import { useDeckState } from '@/lib/deckState';
import { useApp } from '@/lib/store';
import { formatDay } from '@/lib/time';

export default function ShowDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const show = useListings((s) => (id ? s.byId[id] : undefined));
  const decision = useApp((s) => (id ? s.decisions[id]?.decision : undefined));
  const remindersOn = useApp((s) => (id ? !s.reminderOff[id] : true));
  const calendarAt = useApp((s) => (id ? s.calendarAdded[id] : undefined));
  const previews = useShowPreviews(id);
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [playingAct, setPlayingAct] = useState<string | null>(null);
  const [notifOk, setNotifOk] = useState(true);
  const { width } = useWindowDimensions();
  const flyerW = Math.min(width - 32, 460);

  useEffect(
    () => () => useDeckState.setState({ deckDetails: false, detailsPlaying: false }),
    [],
  );

  useEffect(() => {
    if (show) resolveShow(show);
  }, [show]);

  useEffect(() => {
    notificationsAllowed().then(setNotifOk);
  }, [decision]);

  if (!show) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.missing}>This show is no longer listed.</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const acts = [...show.acts].sort((a, b) => a.order - b.order);
  const byName = new Map<string, ActPreview>((previews?.acts ?? []).map((a) => [a.actName, a]));

  const playAct = (name: string) => {
    const p = byName.get(name);
    if (!p || p.status !== 'found') return;
    if (playingAct === name && status.playing) {
      player.pause();
      setPlayingAct(null);
      return;
    }
    useDeckState.setState({ detailsPlaying: true });
    player.replace({ uri: p.track.previewUrl });
    player.play();
    setPlayingAct(name);
  };

  const going = decision === 'going';
  const cancelled = show.status === 'cancelled';
  const toggleGoing = async () => {
    if (going) await removeDecision(show.id);
    else await recordDecision(show.id, 'going');
  };

  const onCalendar = async () => {
    try {
      const ok = await addToCalendar(show);
      if (ok) useApp.getState().markCalendar(show.id);
      else Alert.alert('Calendar', 'Adding to a calendar works on your phone.');
    } catch {
      Alert.alert('Calendar', "Couldn't open your calendar app.");
    }
  };

  const onShare = () =>
    Share.share({
      message: `${showTitle(show)} at ${show.venue.name}, ${formatDay(new Date(show.startsAt))} · ${timeLabel(show)}${
        show.ticketUrl ? `\n${show.ticketUrl}` : ''
      }`,
    }).catch(() => {});

  const onReminders = async (on: boolean) => {
    useApp.getState().setShowReminders(show.id, on);
    await syncReminders();
  };

  const close = () => {
    player.pause();
    router.back();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={28} color={C.text} />
        </Pressable>
        <Pressable onPress={onShare} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={22} color={C.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.flyerWrap}>
          <FlyerArt show={show} width={flyerW} height={Math.round(flyerW * 1.1)} />
        </View>
        <View style={{ gap: 3 }}>
          {show.status !== 'scheduled' ? (
            <Text style={styles.changed}>
              {show.status === 'cancelled' ? 'CANCELLED' : 'DATE OR VENUE CHANGED · CHECK THE LISTING'}
            </Text>
          ) : null}
          <Text style={styles.title}>{showTitle(show)}</Text>
          <Text style={styles.line}>
            {formatDay(new Date(show.startsAt))} · {timeLabel(show)}
          </Text>
          <Text style={styles.line}>{show.venue.name}</Text>
          <Text style={styles.sub}>{calendarLocation(show)}</Text>
        </View>

        <View style={styles.factsRow}>
          <Fact label="Cost" value={priceLabel(show)} />
          <Fact label="Ages" value={AGE_LABELS[show.agePolicy]} />
          <Fact label="Room" value={VENUE_TYPE_LABELS[show.venue.type]} />
        </View>

        <Pressable
          onPress={toggleGoing}
          disabled={cancelled && !going}
          style={[styles.primary, going && styles.primaryOn, cancelled && !going && { opacity: 0.35 }]}
          accessibilityRole="button">
          <Ionicons name={going ? 'checkmark' : 'heart'} size={18} color={going ? C.text : C.accentInk} />
          <Text style={[styles.primaryText, going && { color: C.text }]}>
            {going ? 'Going · tap to undo' : cancelled ? 'Cancelled' : "I'm going"}
          </Text>
        </Pressable>

        {going && cancelled ? (
          <Text style={styles.note}>This show was cancelled, so reminders are off. Tap above to remove it from Going.</Text>
        ) : null}

        {going && !cancelled ? (
          <View style={styles.card}>
            <Row
              icon="calendar-outline"
              label={calendarAt ? 'Added to calendar' : 'Add to calendar'}
              detail={calendarAt ? 'Tap to add again' : 'Opens your calendar app, pre-filled'}
              onPress={onCalendar}
            />
            <View style={styles.divider} />
            <View style={styles.row}>
              <Ionicons name="notifications-outline" size={20} color={C.text} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Reminders</Text>
                <Text style={styles.rowDetail}>
                  {notifOk ? 'Uses your defaults in Settings' : 'Notifications are off for Pull Up in Android settings'}
                </Text>
              </View>
              <Switch
                value={remindersOn}
                onValueChange={onReminders}
                trackColor={{ true: C.accent, false: C.line }}
                thumbColor={C.text}
              />
            </View>
          </View>
        ) : null}

        <Text style={styles.section}>LINEUP</Text>
        <View style={styles.card}>
          {acts.length === 0 ? <Text style={[styles.rowDetail, { padding: 14 }]}>Lineup TBA</Text> : null}
          {acts.map((a, i) => {
            const p = byName.get(a.name);
            const found = p?.status === 'found';
            const isPlaying = playingAct === a.name && status.playing;
            return (
              <View key={a.name}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable style={styles.row} onPress={() => playAct(a.name)} disabled={!found}>
                  <View style={[styles.playDot, found ? styles.playOn : styles.playOff]}>
                    <Ionicons
                      name={!p ? 'ellipsis-horizontal' : found ? (isPlaying ? 'pause' : 'play') : 'volume-mute'}
                      size={14}
                      color={found ? C.accentInk : C.faint}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, i === 0 && { fontFamily: F.uiBold }]}>{a.name}</Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {!p
                        ? 'Looking for a preview…'
                        : p.status === 'found'
                          ? `${p.track.title}${p.confidence === 'possible' ? ' · possible match' : ''}`
                          : 'No preview found'}
                    </Text>
                  </View>
                  {i === 0 ? <Text style={styles.tag}>HEADLINER</Text> : null}
                </Pressable>
              </View>
            );
          })}
        </View>

        {show.ticketUrl ? (
          <Pressable style={styles.secondary} onPress={() => Linking.openURL(show.ticketUrl!)}>
            <Ionicons name="open-outline" size={16} color={C.text} />
            <Text style={styles.secondaryText}>{show.source.provider === 'jambase' ? 'View on JamBase' : 'Open listing'}</Text>
          </Pressable>
        ) : null}

        {decision === 'passed' ? (
          <Pressable style={styles.secondary} onPress={() => removeDecision(show.id)}>
            <Ionicons name="refresh" size={16} color={C.text} />
            <Text style={styles.secondaryText}>Put back in the deck</Text>
          </Pressable>
        ) : null}

        <Text style={styles.note}>
          {show.source.provider === 'jambase' ? 'Listing from JamBase. ' : show.source.provider === 'manual' ? 'Listing added by hand. ' : ''}
          Times, prices and age limits can change; check the listing before you go. Previews come from Deezer and may not
          be the right artist when names are common.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Row(p: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={p.onPress} accessibilityRole="button">
      <Ionicons name={p.icon} size={20} color={C.text} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{p.label}</Text>
        <Text style={styles.rowDetail}>{p.detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 48 },
  content: { padding: 16, paddingTop: 4, gap: 14, paddingBottom: 40 },
  missing: { fontFamily: F.ui, color: C.text, fontSize: 16, padding: 24 },
  link: { fontFamily: F.ui, color: C.accent, fontSize: 16, paddingHorizontal: 24 },
  flyerWrap: { borderRadius: 16, overflow: 'hidden', alignSelf: 'center' },
  changed: { fontFamily: F.monoBold, color: C.danger, fontSize: 12, letterSpacing: 1 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 24, lineHeight: 28 },
  line: { fontFamily: F.ui, color: C.text, fontSize: 14 },
  sub: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12 },
  factsRow: { flexDirection: 'row', gap: 10 },
  fact: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line },
  factLabel: { fontFamily: F.monoBold, color: C.faint, fontSize: 10, letterSpacing: 1.2 },
  factValue: { fontFamily: F.ui, color: C.text, fontSize: 14, marginTop: 2 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 999,
    backgroundColor: C.accent,
  },
  primaryOn: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.accent },
  primaryText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 16 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowLabel: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  rowDetail: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.line, marginLeft: 14 },
  section: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.5, marginTop: 6 },
  playDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  playOn: { backgroundColor: C.accent },
  playOff: { backgroundColor: C.surface2 },
  tag: { fontFamily: F.monoBold, color: C.faint, fontSize: 9, letterSpacing: 1 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
  },
  secondaryText: { fontFamily: F.ui, color: C.text, fontSize: 14 },
  note: { fontFamily: F.uiRegular, color: C.faint, fontSize: 11, lineHeight: 16 },
});
