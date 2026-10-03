import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { C, F } from '@/constants/theme';
import { deviceInfo } from '@/lib/analytics';
import { communityEnabled } from '@/lib/communityConfig';
import { FEEDBACK_KINDS, FEEDBACK_MAX, sendFeedback, type FeedbackKind } from '@/lib/feedback';

export default function FeedbackScreen() {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = deviceInfo();

  if (!communityEnabled) {
    return (
      <View style={styles.screen}>
        <Text style={styles.note}>Feedback is not set up in this build.</Text>
      </View>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    const err = await sendFeedback(kind, message, email);
    setBusy(false);
    if (err) return setError(err);
    Alert.alert('Thank you', 'Your feedback was sent.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>WHAT KIND?</Text>
        <View style={styles.chips}>
          {FEEDBACK_KINDS.map((k) => (
            <Chip key={k.id} label={k.label} on={kind === k.id} onPress={() => setKind(k.id)} />
          ))}
        </View>

        <Text style={styles.label}>{kind === 'bug' ? 'WHAT WENT WRONG?' : 'YOUR MESSAGE'}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={message}
          onChangeText={(t) => setMessage(t.slice(0, FEEDBACK_MAX))}
          multiline
          textAlignVertical="top"
          placeholder={kind === 'bug' ? 'What you did, what you expected, what happened' : 'Tell us what you think'}
          placeholderTextColor={C.faint}
          accessibilityLabel="Message"
        />
        <Text style={styles.count}>
          {message.length}/{FEEDBACK_MAX}
        </Text>

        <Text style={styles.label}>YOUR EMAIL (OPTIONAL, ONLY IF YOU WANT A REPLY)</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={C.faint}
          accessibilityLabel="Email address (optional)"
        />

        <Text style={styles.note}>
          Sent with your message: app version {info.app_version}, {info.os_version}, device {info.device_model}. Nothing else is
          attached: no location, no contacts and no account details.
        </Text>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Pressable style={styles.btn} onPress={send} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={styles.btnText}>Send feedback</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  label: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.5, marginTop: 10 },
  chips: { flexDirection: 'row', gap: 8 },
  input: { borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontFamily: F.uiRegular, fontSize: 16 },
  multiline: { minHeight: 140 },
  count: { fontFamily: F.mono, color: C.faint, fontSize: 11, textAlign: 'right' },
  note: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
  btn: { height: 48, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
});
