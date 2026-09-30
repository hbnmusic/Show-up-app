import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import type { ActPreview } from '@/lib/previews';

type Found = Extract<ActPreview, { status: 'found' }>;

export type AudioBarProps = {
  loading: boolean;
  current?: Found;
  index: number;
  count: number;
  playing: boolean;
  progress: number;
  interactive: boolean;
  onToggle?: () => void;
  onNext?: () => void;
  onWrongArtist?: (act: Found) => void;
};

export function AudioBar(p: AudioBarProps) {
  const askWrong = () => {
    if (!p.current || !p.onWrongArtist) return;
    const act = p.current;
    Alert.alert(
      'Is this the right artist?',
      `This preview is "${act.track.title}" by ${act.track.artistName}, matched to the act ${act.actName}.`,
      [
        { text: 'Looks right', style: 'cancel' },
        { text: 'Wrong artist', style: 'destructive', onPress: () => p.onWrongArtist?.(act) },
      ],
    );
  };

  if (p.loading && !p.current) {
    return (
      <View style={styles.bar}>
        <ActivityIndicator color={C.muted} size="small" style={styles.iconSlot} />
        <Text style={styles.muted}>Finding a preview…</Text>
      </View>
    );
  }

  if (!p.current) {
    return (
      <View style={styles.bar}>
        <View style={[styles.iconSlot, styles.playDisabled]}>
          <Ionicons name="volume-mute" size={18} color={C.faint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.muted}>No preview yet</Text>
          <Text style={styles.small}>Spread two fingers for the full lineup</Text>
        </View>
      </View>
    );
  }

  const act = p.current;
  return (
    <Pressable
      style={styles.bar}
      onPress={p.interactive ? p.onToggle : undefined}
      onLongPress={p.interactive ? askWrong : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${p.playing ? 'Pause' : 'Play'} preview: ${act.track.title} by ${act.actName}`}>
      <View style={[styles.iconSlot, styles.play]}>
        <Ionicons name={p.playing ? 'pause' : 'play'} size={18} color={C.accentInk} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.act} numberOfLines={1}>
          {act.actName}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.small} numberOfLines={1}>
            {act.track.title} · Deezer
          </Text>
          {act.confidence === 'possible' ? (
            <Pressable onPress={p.interactive ? askWrong : undefined} hitSlop={8}>
              <Text style={styles.possible}>Possible match</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {p.count > 1 ? (
        <Pressable
          onPress={p.interactive ? p.onNext : undefined}
          hitSlop={10}
          style={styles.next}
          accessibilityRole="button"
          accessibilityLabel="Play the next act on the bill">
          <Ionicons name="play-skip-forward" size={16} color={C.text} />
          <Text style={styles.nextText}>
            {p.index + 1}/{p.count}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, p.progress * 100))}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: C.surface2,
  },
  iconSlot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  play: { backgroundColor: C.accent },
  playDisabled: { backgroundColor: C.surface },
  act: { fontFamily: F.uiBold, color: C.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  small: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12, flexShrink: 1 },
  muted: { fontFamily: F.ui, color: C.muted, fontSize: 14 },
  possible: {
    fontFamily: F.monoBold,
    fontSize: 10,
    color: C.warn,
    borderColor: C.warn,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  next: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  nextText: { fontFamily: F.mono, color: C.text, fontSize: 12 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: C.line },
  fill: { height: 2, backgroundColor: C.accent },
});
