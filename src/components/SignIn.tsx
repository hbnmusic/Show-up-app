import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal';

/** Email + one-time code. Calls onDone after a successful sign-in. */
export function SignIn({ onDone, reason }: { onDone?: () => void; reason?: string }) {
  const sendCode = useAuth((s) => s.sendCode);
  const verifyCode = useAuth((s) => s.verifyCode);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg('Enter a valid email address.');
    setBusy(true);
    setMsg(null);
    const err = await sendCode(email);
    setBusy(false);
    if (err) setMsg(err);
    else setStep('code');
  };

  const verify = async () => {
    setBusy(true);
    setMsg(null);
    const err = await verifyCode(email, code);
    setBusy(false);
    if (err) setMsg(err);
    else onDone?.();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Sign in to add and confirm shows</Text>
      <Text style={styles.body}>
        {reason ?? 'Enter your email and we send a 6-digit code. No password, and your email is never shown to other people.'}
      </Text>
      {step === 'email' ? (
        <>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel="Email address"
            onSubmitEditing={send}
          />
          <Pressable style={styles.btn} onPress={send} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.btnText}>Email me a code</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.body}>Code sent to {email.trim()}. It can take a minute to arrive; check spam.</Text>
          <TextInput
            style={[styles.input, styles.code]}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))}
            placeholder="123456"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            accessibilityLabel="Sign-in code"
            onSubmitEditing={verify}
          />
          <Pressable style={styles.btn} onPress={verify} disabled={busy || code.length < 6} accessibilityRole="button">
            {busy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.btnText}>Sign in</Text>}
          </Pressable>
          <Pressable
            onPress={() => {
              setStep('email');
              setCode('');
              setMsg(null);
            }}
            hitSlop={8}>
            <Text style={styles.link}>Use a different email</Text>
          </Pressable>
        </>
      )}
      {msg ? <Text style={styles.err}>{msg}</Text> : null}
      <Text style={styles.fine}>
        You must be 16 or older. By continuing you agree to the{' '}
        <Text style={styles.fineLink} onPress={() => Linking.openURL(TERMS_URL)}>
          Terms of Use
        </Text>{' '}
        and acknowledge the{' '}
        <Text style={styles.fineLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, padding: 14 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, lineHeight: 18 },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    paddingHorizontal: 14,
    color: C.text,
    fontFamily: F.uiRegular,
    fontSize: 16,
  },
  code: { fontFamily: F.monoBold, letterSpacing: 6, textAlign: 'center', fontSize: 20 },
  btn: { height: 46, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
  link: { fontFamily: F.ui, color: C.muted, fontSize: 13, textDecorationLine: 'underline', textAlign: 'center' },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
  fine: { fontFamily: F.uiRegular, color: C.faint, fontSize: 11, lineHeight: 16 },
  fineLink: { color: C.muted, textDecorationLine: 'underline' },
});
