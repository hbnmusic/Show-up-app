import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { useGoing } from '@/lib/going/store';

/** One-time inline note shown after the first Going. Not a dialog: it sits in the screen and never blocks anything. */
export function GoingNote() {
  const visible = useGoing((s) => s.noteVisible);
  if (!visible) return null;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.text}>
        Your Going counts toward the number shown on shows, anonymously.{' '}
        <Text
          style={styles.link}
          accessibilityRole="link"
          onPress={() => {
            useGoing.getState().hideNote();
            router.push('/settings');
          }}>
          Change in Settings
        </Text>
      </Text>
      <Pressable onPress={() => useGoing.getState().hideNote()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Text style={styles.dismiss}>OK</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
  text: { flex: 1, fontFamily: F.uiRegular, color: C.muted, fontSize: 12, lineHeight: 17 },
  link: { color: C.text, textDecorationLine: 'underline' },
  dismiss: { fontFamily: F.monoBold, color: C.text, fontSize: 12 },
});
