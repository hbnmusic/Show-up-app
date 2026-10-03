import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from '@/lib/legal';

/** Shown before a person's first submission or confirmation. Records the version and time on the server. */
export function TermsGate({ onAccept, error }: { onAccept: () => Promise<boolean>; error?: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Before you add or confirm shows</Text>
      <Text style={styles.body}>
        Shows you add are visible to other people. Only add real events, do not post anything offensive, misleading or
        private, and do not add shows you do not know to be real. Reports and blocks are available on every community
        show, and we may remove content or accounts that break these rules.
      </Text>
      <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={6} accessibilityRole="link">
        <Text style={styles.link}>Read the Terms of Use</Text>
      </Pressable>
      <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={6} accessibilityRole="link">
        <Text style={styles.link}>Read the Privacy Policy</Text>
      </Pressable>
      <Pressable
        style={styles.btn}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await onAccept();
          setBusy(false);
        }}
        accessibilityRole="button">
        {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={styles.btnText}>I agree to the Terms of Use</Text>}
      </Pressable>
      <Text style={styles.small}>We save which version you accepted ({TERMS_VERSION}) and when.</Text>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 14 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, lineHeight: 19 },
  link: { fontFamily: F.ui, color: C.text, fontSize: 13, textDecorationLine: 'underline' },
  btn: { height: 46, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  btnText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
  small: { fontFamily: F.uiRegular, color: C.faint, fontSize: 11 },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
});
