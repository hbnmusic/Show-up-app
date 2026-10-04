import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { FlyerArt } from '@/components/FlyerArt';
import { C, F } from '@/constants/theme';
import { addToCalendar } from '@/lib/calendar';
import { recordDecision, removeDecision } from '@/lib/decide';
import type { Decision } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { COMMUNITY_PREFIX } from '@/lib/community/form';
import { track } from '@/lib/analyticsCore';
import { ModerationSheet } from '@/components/ModerationSheet';
import { useListings } from '@/lib/listingsStore';
import { playableActs, resolveShow, useShowPreviews, type ActPreview } from '@/lib/previews';
import { notificationsAllowed, syncReminders } from '@/lib/reminders';
import {
  calendarLocation,
  factsFor,
  showTitle,
  timeLabel,
} from '@/lib/showText';
import { useDeckState } from '@/lib/deckState';
import { useApp } from '@/lib/store';
import { conflictNotes, isFirstParty, sourcesNote, ticketLabel } from '@/lib/fpText';
import { reportFpShow, withdrawFpShow } from '@/lib/fp/api';
import { formatDay, wall } from '@/lib/time';

export default function ShowDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const show = useListings((s) => (id ? s.byId[id] : undefined));
  const shownProvider = show?.source.provider;
  useEffect(() => {
    if (shownProvider) track('show_opened', { provider: shownProvider });
  }, [id, shownProvider]);
  const decision = useApp((s) => (id ? s.decisions[id]?.decision : undefined));
  const remindersOn = useApp((s) => (id ? !s.reminderOff[id] : true));
  const calendarAt = useApp((s) => (id ? s.calendarAdded[id] : undefined));
  const previews = useShowPreviews(id);
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [playingAct, setPlayingAct] = useState<string | null>(null);
  const [moderating, setModerating] = useState(false);
  const [notifOk, setNotifOk] = useState(true);
  const { width } = useWindowDimensions();
  const flyerW = Math.min(width - 32, 460);

  useEffect(
    () => () => useDeckState.setState({ deckDetails: false, detailsPlaying: false }),
    [],
  );

  // Opened from the deck (not from Going or a reminder) on a show not yet decided:
  // swipe right to go, left to pass, same as on the card. Vertical drags still scroll.
  const [fromDeck] = useState(() => useDeckState.getState().deckDetails);
  const canSwipe = fromDeck && !decision;
  const tx = useSharedValue(0);
  const threshold = width * 0.3;

  const finishSwipe = (d: Decision) => {
    player.pause();
    if (id) useDeckState.setState({ swipeRequest: { id, d } });
    router.back();
  };

  const swipe = Gesture.Pan()
    .enabled(canSwipe)
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      const right = e.translationX > threshold || (e.velocityX > 900 && e.translationX > 40);
      const left = e.translationX < -threshold || (e.velocityX < -900 && e.translationX < -40);
      if (right || left) {
        tx.value = withTiming((right ? 1 : -1) * width * 1.3, { duration: 200 }, (done) => {
          if (done) scheduleOnRN(finishSwipe, right ? 'going' : 'passed');
        });
        return;
      }
      tx.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { rotate: `${(tx.value / width) * 6}deg` }],
  }));
  const goingTag = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, threshold], [0, 1], Extrapolation.CLAMP) }));
  const passTag = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [-threshold, 0], [1, 0], Extrapolation.CLAMP) }));

  useEffect(() => {
    if (show) resolveShow(show);
  }, [show]);

  // Opened from Going, Submitted or a reminder (not from the deck, whose own player keeps going behind this screen):
  // start the first preview by itself when previews are ready, then follow the bill, same as the deck. Honours the autoplay setting.
  const autoplay = useApp((s) => s.autoplay);
  const playable = playableActs(previews);
  const chain = useRef(false);
  const startedFor = useRef<string | null>(null);
  const live = useRef({ playable, playingAct });
  useEffect(() => {
    live.current = { playable, playingAct };
  });
  const firstUrl = playable[0]?.track.previewUrl;
  const firstName = playable[0]?.actName;
  useEffect(() => {
    if (fromDeck || !autoplay || !id || !firstUrl || !firstName || startedFor.current === id) return;
    startedFor.current = id;
    chain.current = true;
    useDeckState.setState({ detailsPlaying: true });
    player.replace({ uri: firstUrl });
    player.play();
    setPlayingAct(firstName);
  }, [fromDeck, autoplay, id, firstUrl, firstName, player]);
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      if (!st.didJustFinish || !chain.current) return;
      const { playable: list, playingAct: cur } = live.current;
      const next = list[list.findIndex((a) => a.actName === cur) + 1];
      if (!next) {
        chain.current = false;
        setPlayingAct(null);
        return;
      }
      player.replace({ uri: next.track.previewUrl });
      player.play();
      setPlayingAct(next.actName);
    });
    return () => sub.remove();
  }, [player]);

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
    chain.current = false;
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
      message: `${showTitle(show)} at ${show.venue.name}, ${formatDay(wall(show.startsAt))} · ${timeLabel(show)}${
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
        {canSwipe ? <Text style={styles.swipeHint}>← pass · swipe · going →</Text> : null}
        <Pressable onPress={onShare} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={22} color={C.text} />
        </Pressable>
      </View>
      <GestureDetector gesture={swipe}>
      <Animated.View style={[{ flex: 1 }, slideStyle]}>
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
            {formatDay(wall(show.startsAt))} · {timeLabel(show)}
          </Text>
          <Text style={styles.line}>{show.venue.name}</Text>
          <Text style={styles.sub}>{calendarLocation(show)}</Text>
        </View>

        <View style={styles.factsRow}>
          {factsFor(show).map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
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
            <Text style={styles.secondaryText}>{ticketLabel(show)}</Text>
          </Pressable>
        ) : null}

        {show.source.provider === 'community' && show.id.startsWith(COMMUNITY_PREFIX) ? (
          <Pressable
            style={styles.secondary}
            onPress={() => {
              if (!useAuth.getState().userId) return router.push('/community');
              setModerating(true);
            }}>
            <Ionicons name="flag-outline" size={16} color={C.text} />
            <Text style={styles.secondaryText}>Report or block</Text>
          </Pressable>
        ) : null}

        {show.provenance?.fpId && isFirstParty(show) ? (
          show.provenance.pending ? (
            <Pressable
              style={styles.secondary}
              onPress={async () => {
                const r = await withdrawFpShow(show.provenance!.fpId!);
                Alert.alert(r.ok ? 'Withdrawn' : 'Could not withdraw', r.ok ? 'The show was removed.' : r.error);
                if (r.ok) useListings.getState().refreshFirstParty();
              }}>
              <Ionicons name="close-circle-outline" size={16} color={C.text} />
              <Text style={styles.secondaryText}>Withdraw this show</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.secondary}
              onPress={() => {
                if (!useAuth.getState().userId) return router.push('/community');
                Alert.alert('Report this listing?', 'Use this if the show is fake, wrong or should not be listed. Three reports remove it.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Report',
                    style: 'destructive',
                    onPress: async () => {
                      const r = await reportFpShow(show.provenance!.fpId!);
                      Alert.alert(r.ok ? 'Thanks' : 'Could not send', r.ok ? 'We will review it.' : r.error);
                    },
                  },
                ]);
              }}>
              <Ionicons name="flag-outline" size={16} color={C.text} />
              <Text style={styles.secondaryText}>Report this listing</Text>
            </Pressable>
          )
        ) : null}

        {show.provenance?.pending ? <Text style={styles.note}>Only you can see this show until a second person confirms it.</Text> : null}
        {show.provenance?.unconfirmed ? <Text style={styles.note}>The venue&apos;s page stopped listing this show. It may have been cancelled or moved; check with the venue.</Text> : null}
        {conflictNotes(show).map((t) => (
          <Text key={t} style={styles.note}>{t}</Text>
        ))}

        {decision === 'passed' ? (
          <Pressable style={styles.secondary} onPress={() => removeDecision(show.id)}>
            <Ionicons name="refresh" size={16} color={C.text} />
            <Text style={styles.secondaryText}>Put back in the deck</Text>
          </Pressable>
        ) : null}

        <Text style={styles.note}>
          {show.source.provider === 'jambase' ? 'Listing from JamBase. ' : show.source.provider === 'manual' ? 'Listing added by hand. ' : show.source.provider === 'community' ? 'Added by the Pull Up community and confirmed by a second person; not checked by the venue. ' : ''}
          {sourcesNote(show) ? `${sourcesNote(show)} ` : ''}
          Times and prices can change; check the listing before you go. Previews come from Deezer and may not
          be the right artist when names are common.
        </Text>
      </ScrollView>
      </Animated.View>
      </GestureDetector>
      {moderating ? <ModerationSheet show={show} onClose={() => setModerating(false)} /> : null}
      {canSwipe ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.swipeTag, styles.tagGoing, goingTag]}>
            <Text style={styles.tagText}>GOING</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.swipeTag, styles.tagPass, passTag]}>
            <Text style={styles.tagText}>PASS</Text>
          </Animated.View>
        </>
      ) : null}
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
  swipeHint: { fontFamily: F.mono, color: C.faint, fontSize: 11 },
  swipeTag: { position: 'absolute', top: 120, borderWidth: 3, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(12,11,10,0.7)' },
  tagGoing: { right: 20, borderColor: C.good },
  tagPass: { left: 20, borderColor: C.pass },
  tagText: { fontFamily: F.poster, color: C.text, fontSize: 22, letterSpacing: 2 },
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
