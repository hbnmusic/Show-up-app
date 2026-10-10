import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { addDaysYmd, inRange, monthGrid, nextRange, parseYmd, ymd } from '@/lib/dateRange';
import { MONTHS } from '@/lib/time';
import type { DateRange } from '@/lib/types';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** Listings never run further than a year ahead. */
const REACH_DAYS = 365;

/** A month calendar for choosing one date or a range: tap a day, then tap a later day to extend it. */
export function DateRangePicker({ value, onChange, today }: { value: DateRange | null; onChange: (r: DateRange | null) => void; today?: string }) {
  const first = today ?? ymd(new Date());
  const last = addDaysYmd(first, REACH_DAYS);
  const start = parseYmd(value?.from ?? first) ?? new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const lo = parseYmd(first)!;
  const hi = parseYmd(last)!;
  const canPrev = view.y * 12 + view.m > lo.getFullYear() * 12 + lo.getMonth();
  const canNext = view.y * 12 + view.m < hi.getFullYear() * 12 + hi.getMonth();
  const go = (delta: number) => setView((v) => {
    const t = v.y * 12 + v.m + delta;
    return { y: Math.floor(t / 12), m: t % 12 };
  });

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Pressable onPress={() => go(-1)} disabled={!canPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={[styles.arrow, !canPrev && styles.off]}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{MONTHS[view.m]} {view.y}</Text>
        <Pressable onPress={() => go(1)} disabled={!canNext} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month">
          <Text style={[styles.arrow, !canNext && styles.off]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.week}>
        {DAYS.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
      </View>
      {monthGrid(view.y, view.m).map((w, i) => (
        <View key={i} style={styles.week}>
          {w.map((day, j) => {
            if (!day) return <View key={j} style={styles.cell} />;
            const disabled = day < first || day > last;
            const selected = inRange(value, day);
            const edge = !!value && (day === value.from || day === value.to);
            return (
              <Pressable
                key={j}
                style={[styles.cell, selected && styles.inRange, edge && styles.edge]}
                disabled={disabled}
                onPress={() => onChange(nextRange(value, day))}
                accessibilityRole="button"
                accessibilityLabel={day}
                accessibilityState={{ selected, disabled }}>
                <Text style={[styles.dayText, disabled && styles.off, edge && styles.edgeText]}>{Number(day.slice(8))}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={styles.hint}>
        {value ? (value.from === value.to ? 'Tap a later day to make it a range.' : 'Tap any day to start again.') : 'Tap a day, or tap two days for a range.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 10, gap: 4, width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 },
  arrow: { fontFamily: F.uiBold, color: C.text, fontSize: 24, paddingHorizontal: 8 },
  month: { fontFamily: F.uiBold, color: C.text, fontSize: 15 },
  week: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center', fontFamily: F.ui, color: C.faint, fontSize: 12, paddingVertical: 4 },
  cell: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  inRange: { backgroundColor: C.surface2 },
  edge: { backgroundColor: C.accent, borderRadius: 999 },
  dayText: { fontFamily: F.uiRegular, color: C.text, fontSize: 14 },
  edgeText: { fontFamily: F.uiBold, color: C.accentInk },
  off: { color: C.faint, opacity: 0.45 },
  hint: { fontFamily: F.uiRegular, color: C.faint, fontSize: 12, paddingTop: 6, textAlign: 'center' },
});
