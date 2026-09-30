import { StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { AGE_LABELS, VENUE_TYPE_LABELS, priceLabel, timeLabel } from '@/lib/showText';
import { formatDay } from '@/lib/time';
import type { Show } from '@/lib/types';

/** Last slide on every card: the facts, legible at phone size. */
export function InfoSlide({ show, width, height }: { show: Show; width: number; height: number }) {
  const acts = [...show.acts].sort((a, b) => a.order - b.order);
  const where =
    show.venue.addressVisibility === 'public'
      ? `${show.venue.neighborhood}, ${show.venue.city}`
      : `${show.venue.neighborhood} · address on request`;
  return (
    <View style={[styles.wrap, { width, height }]}>
      <Text style={styles.kicker}>THE BILL</Text>
      {show.title ? <Text style={styles.title}>{show.title}</Text> : null}
      <View style={{ gap: 6, marginTop: 8 }}>
        {acts.length === 0 ? <Text style={styles.act}>Lineup TBA</Text> : null}
        {acts.slice(0, 6).map((a, i) => (
          <View key={a.name} style={styles.actRow}>
            <Text style={styles.num}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={[styles.act, i === 0 && styles.head]} numberOfLines={1}>
              {a.name}
            </Text>
          </View>
        ))}
        {acts.length > 6 ? <Text style={styles.more}>+ {acts.length - 6} more</Text> : null}
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.grid}>
        <Fact label="When" value={`${formatDay(new Date(show.startsAt))}\n${timeLabel(show)}`} />
        <Fact label="Where" value={`${show.venue.name}\n${where}`} />
        <Fact label="Cost" value={priceLabel(show)} />
        <Fact label="Ages" value={AGE_LABELS[show.agePolicy]} />
        <Fact label="Room" value={VENUE_TYPE_LABELS[show.venue.type]} />
      </View>
      <Text style={styles.note}>Details can change. Confirm with the venue before you go.</Text>
    </View>
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

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#121110', padding: 22 },
  kicker: { fontFamily: F.monoBold, color: C.accent, fontSize: 12, letterSpacing: 2 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 18, marginTop: 6 },
  actRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  num: { fontFamily: F.mono, color: C.faint, fontSize: 12, width: 22 },
  act: { fontFamily: F.ui, color: C.text, fontSize: 18, flexShrink: 1 },
  head: { fontFamily: F.uiBold, fontSize: 22 },
  more: { fontFamily: F.mono, color: C.muted, fontSize: 12, marginLeft: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 12 },
  fact: { width: '47%' },
  factLabel: { fontFamily: F.monoBold, color: C.faint, fontSize: 10, letterSpacing: 1.5 },
  factValue: { fontFamily: F.ui, color: C.text, fontSize: 14, marginTop: 2 },
  note: { fontFamily: F.uiRegular, color: C.faint, fontSize: 11, marginTop: 14 },
});
