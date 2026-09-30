import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';

type Props = {
  label: string;
  on?: boolean;
  onPress?: () => void;
  badge?: number;
  icon?: React.ReactNode;
};

export function Chip({ label, on, onPress, badge, icon }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.on, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}>
      {icon}
      <Text style={[styles.text, on && styles.textOn]}>{label}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
  },
  on: { backgroundColor: C.text, borderColor: C.text },
  text: { fontFamily: F.ui, color: C.text, fontSize: 13 },
  textOn: { color: C.bg },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 11 },
});
