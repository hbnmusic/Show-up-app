import { StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { formatGoing } from '@/lib/shareText';

/** "N going", only when the server returned a count for the show. Renders nothing otherwise. */
export function GoingChip({ n }: { n: number | null }) {
  if (n == null || n < 1) return null;
  return (
    <View style={styles.chip} accessibilityLabel={formatGoing(n)}>
      <Text style={styles.text}>{formatGoing(n)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: C.line, paddingHorizontal: 9, paddingVertical: 3 },
  text: { fontFamily: F.mono, color: C.muted, fontSize: 11 },
});
