import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlyerThumb } from '@/components/FlyerArt';
import { C, F } from '@/constants/theme';
import { useNow } from '@/hooks/useNow';
import { recordDecision, removeDecision } from '@/lib/decide';
import { byStart } from '@/lib/filters';
import { useListings } from '@/lib/listingsStore';
import { metaLine, placeLabel, showTitle, supportActs, timeLabel } from '@/lib/showText';
import { useApp } from '@/lib/store';
import { addDays, formatDay, relativeDay, sameDay, startOfDay, wall, wallNow } from '@/lib/time';
import type { Show } from '@/lib/types';

type Tab = 'upcoming' | 'past' | 'passed';

/** A show moves to Past the morning after (5 AM). */
function isPast(s: Show, now: Date): boolean {
  const cutoff = startOfDay(addDays(wall(s.startsAt), 1));
  cutoff.setHours(5);
  return wallNow(s.startsAt, now).getTime() >= cutoff.getTime();
}

export default function GoingScreen() {
  const now = useNow();
  const decisions = useApp((s) => s.decisions);
  const byId = useListings((s) => s.byId);
  const reminderOff = useApp((s) => s.reminderOff);
  const calendarAdded = useApp((s) => s.calendarAdded);
  const attendance = useApp((s) => s.attendance);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [removed, setRemoved] = useState<Show | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { upcoming, past, passed, unlisted } = useMemo(() => {
    const going: Show[] = [];
    const passedList: Show[] = [];
    const missing: string[] = [];
    for (const [id, r] of Object.entries(decisions)) {
      const s = byId[id];
      if (!s) {
        if (r.decision === 'going') missing.push(id);
        continue;
      }
      if (r.decision === 'going') going.push(s);
      else passedList.push(s);
    }
    going.sort(byStart);
    return {
      upcoming: going.filter((s) => !isPast(s, now)),
      past: going.filter((s) => isPast(s, now)).reverse(),
      passed: passedList.filter((s) => !isPast(s, now)).sort(byStart),
      unlisted: missing,
    };
  }, [decisions, byId, now]);

  const sections = useMemo(() => {
    if (tab === 'past') return past.length ? [{ title: '', data: past }] : [];
    if (tab === 'passed') return passed.length ? [{ title: '', data: passed }] : [];
    const tonight: Show[] = [];
    const week: Show[] = [];
    const later: Show[] = [];
    for (const s of upcoming) {
      const d = wall(s.startsAt);
      const nowThere = wallNow(s.startsAt, now);
      const weekEnd = addDays(startOfDay(nowThere), 7).getTime();
      if (sameDay(d, nowThere) || d.getTime() < nowThere.getTime()) tonight.push(s);
      else if (d.getTime() < weekEnd) week.push(s);
      else later.push(s);
    }
    return [
      { title: 'Tonight', data: tonight },
      { title: 'This week', data: week },
      { title: 'Later', data: later },
    ].filter((x) => x.data.length > 0);
  }, [tab, upcoming, past, passed, now]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const remove = (s: Show) => {
    removeDecision(s.id);
    setRemoved(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setRemoved(null), 4000);
  };

  const undoRemove = () => {
    if (!removed) return;
    recordDecision(removed.id, 'going');
    setRemoved(null);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Going</Text>
        <Pressable onPress={() => router.push('/settings')} hitSlop={12} accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={22} color={C.muted} />
        </Pressable>
      </View>
      <View style={styles.segment}>
        <Seg label={`Upcoming · ${upcoming.length}`} on={tab === 'upcoming'} onPress={() => setTab('upcoming')} />
        <Seg label="Past" on={tab === 'past'} onPress={() => setTab('past')} />
        <Seg label="Passed" on={tab === 'passed'} onPress={() => setTab('passed')} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: 90, flexGrow: 1 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text> : null
        }
        ListEmptyComponent={<Empty tab={tab} />}
        ListFooterComponent={
          tab === 'upcoming' && unlisted.length > 0 ? (
            <View style={styles.unlisted}>
              <Text style={styles.unlistedText}>
                {unlisted.length === 1
                  ? '1 saved show is no longer in the listings.'
                  : `${unlisted.length} saved shows are no longer in the listings.`}
              </Text>
              <Pressable onPress={() => unlisted.forEach((id) => removeDecision(id))} hitSlop={8}>
                <Text style={styles.toastUndoLight}>Clear</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const row = (
            <ShowRow
              onRemove={() => remove(item)}
              show={item}
              now={now}
              tab={tab}
              reminders={!reminderOff[item.id] && item.status !== 'cancelled'}
              inCalendar={!!calendarAdded[item.id]}
              attendance={attendance[item.id]}
            />
          );
          if (tab !== 'upcoming') return row;
          return (
            <ReanimatedSwipeable
              friction={1.6}
              rightThreshold={80}
              overshootRight={false}
              onSwipeableOpen={() => remove(item)}
              renderRightActions={() => (
                <View style={styles.swipeAction}>
                  <Ionicons name="close-circle" size={20} color={C.text} />
                  <Text style={styles.swipeText}>Not going</Text>
                </View>
              )}>
              {row}
            </ReanimatedSwipeable>
          );
        }}
      />

      {removed ? (
        <View style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={1}>
            Removed {showTitle(removed)}
          </Text>
          <Pressable onPress={undoRemove} hitSlop={10}>
            <Text style={styles.toastUndo}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
    </Pressable>
  );
}

function ShowRow(p: {
  onRemove: () => void;
  show: Show;
  now: Date;
  tab: Tab;
  reminders: boolean;
  inCalendar: boolean;
  attendance?: 'went' | 'skipped';
}) {
  const s = p.show;
  const more = supportActs(s).length;
  const start = wall(s.startsAt);
  const setAttendance = useApp((st) => st.setAttendance);
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/show/${s.id}`)} accessibilityRole="button">
      <FlyerThumb show={s} size={64} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {s.status !== 'scheduled' ? (
          <Text style={styles.rowFlag} numberOfLines={1}>
            {s.status === 'cancelled' ? 'CANCELLED' : 'CHANGED · CHECK LISTING'}
          </Text>
        ) : null}
        <Text style={[styles.rowWhen, s.status === 'cancelled' && styles.struck]} numberOfLines={1}>
          {p.tab === 'upcoming' ? relativeDay(start, wallNow(s.startsAt, p.now)) : formatDay(start)} · {timeLabel(s)}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {showTitle(s)}
          {more ? <Text style={styles.rowMore}>  + {more} more</Text> : null}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {placeLabel(s)}
        </Text>
        {p.tab === 'past' ? (
          <View style={styles.attendRow}>
            <AttendButton
              label="Went"
              on={p.attendance === 'went'}
              onPress={() => setAttendance(s.id, p.attendance === 'went' ? null : 'went')}
            />
            <AttendButton
              label="Didn't go"
              on={p.attendance === 'skipped'}
              onPress={() => setAttendance(s.id, p.attendance === 'skipped' ? null : 'skipped')}
            />
          </View>
        ) : (
          metaLine(s) ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {metaLine(s)}
            </Text>
          ) : null
        )}
      </View>
      {p.tab === 'upcoming' ? (
        <View style={styles.icons}>
          <Ionicons name={p.inCalendar ? 'calendar' : 'calendar-outline'} size={16} color={p.inCalendar ? C.text : C.faint} />
          <Ionicons
            name={p.reminders ? 'notifications' : 'notifications-off-outline'}
            size={16}
            color={p.reminders ? C.text : C.faint}
          />
        </View>
      ) : null}
      {p.tab !== 'passed' ? (
        <Pressable
          onPress={p.onRemove}
          hitSlop={10}
          style={styles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${showTitle(s)} from Going`}>
          <Ionicons name="trash-outline" size={19} color={C.muted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function AttendButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.attend, on && styles.attendOn]} hitSlop={6}>
      <Text style={[styles.attendText, on && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ tab }: { tab: Tab }) {
  const text =
    tab === 'upcoming'
      ? 'Swipe right on a show to save it here.'
      : tab === 'past'
        ? 'Shows you went to will land here the morning after.'
        : "Shows you pass on stay here until they happen, in case you change your mind.";
  return (
    <View style={styles.empty}>
      <Ionicons name={tab === 'passed' ? 'close-circle-outline' : 'ticket-outline'} size={36} color={C.faint} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  removeBtn: { paddingLeft: 10, paddingVertical: 8, alignSelf: 'center' },
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  title: { fontFamily: F.poster, color: C.text, fontSize: 28, letterSpacing: 1 },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: C.line,
  },
  seg: { flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.text },
  segText: { fontFamily: F.ui, color: C.muted, fontSize: 13 },
  segTextOn: { color: C.bg },
  sectionTitle: {
    fontFamily: F.monoBold,
    color: C.faint,
    fontSize: 11,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.bg,
  },
  rowFlag: { fontFamily: F.monoBold, color: C.danger, fontSize: 10, letterSpacing: 1 },
  struck: { textDecorationLine: 'line-through' },
  rowWhen: { fontFamily: F.uiBold, color: C.accent, fontSize: 12 },
  rowTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  rowMore: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13 },
  rowSub: { fontFamily: F.ui, color: C.text, fontSize: 13 },
  rowMeta: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12 },
  icons: { gap: 8, alignItems: 'center' },
  attendRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  attend: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  attendOn: { backgroundColor: C.text, borderColor: C.text },
  attendText: { fontFamily: F.ui, color: C.text, fontSize: 12 },
  swipeAction: {
    backgroundColor: '#5A1B12',
    justifyContent: 'center',
    alignItems: 'center',
    width: 110,
    gap: 4,
  },
  swipeText: { fontFamily: F.ui, color: C.text, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, marginTop: 60 },
  emptyText: { fontFamily: F.uiRegular, color: C.muted, fontSize: 15, textAlign: 'center' },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: C.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  unlisted: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 18, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  unlistedText: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, flex: 1 },
  toastUndoLight: { fontFamily: F.uiBold, color: C.accent, fontSize: 13 },
  toastText: { fontFamily: F.ui, color: C.bg, fontSize: 14, flex: 1 },
  toastUndo: { fontFamily: F.uiBold, color: C.accent, fontSize: 14 },
});
