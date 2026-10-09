import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TermsGate } from '@/components/TermsGate';
import { C, F } from '@/constants/theme';
import { track } from '@/lib/analyticsCore';
import { useAuth } from '@/lib/auth';
import { acceptTerms, fetchTermsAccepted } from '@/lib/community/api';
import { linkFetchViaServer, submitFlyerText } from '@/lib/fp/api';
import { recognizeImage } from '@/lib/flyer/ocr';
import { handleLink, handleText, LINK_FAILED_MESSAGE, phonePreview, readFlyerImage, sendPrepared, type FlyerDeps, type Outcome } from '@/lib/flyer/share';
import { useFlyers } from '@/lib/flyer/store';
import { CONFIRMATION_RULES, FLYER_PAUSED_MESSAGE, intakeGate, reasonText, READER_PAUSED_TEXT, THANKS_BODY, THANKS_TITLE } from '@/lib/flyer/status';
import { useFlag, useFlags } from '@/lib/flags';
import { TERMS_VERSION } from '@/lib/legal';
import { useListings } from '@/lib/listingsStore';
import { useApp } from '@/lib/store';

type Item = { key: string; label: string; state: 'waiting' | 'working' | 'done'; outcome?: Outcome };

const deps: FlyerDeps = {
  ocr: recognizeImage,
  previewOnPhone: phonePreview,
  previewOnServer: async (url) => {
    const r = await linkFetchViaServer(url);
    return r.ok && r.data.ok ? { imageUrl: r.data.imageUrl, caption: r.data.caption, title: r.data.title } : null;
  },
  submit: submitFlyerText,
  track,
};

function describe(o: Outcome): { tone: 'good' | 'wait' | 'bad'; text: string } {
  switch (o.kind) {
    case 'submitted': {
      const r = o.reply;
      if (r.status === 'paused') return r.reason === 'ai_paused' ? { tone: 'wait', text: READER_PAUSED_TEXT } : { tone: 'bad', text: FLYER_PAUSED_MESSAGE };
      if (r.result === 'published') return { tone: 'good', text: 'Received. It is already confirmed and live.' };
      if (r.result === 'pending') return { tone: 'wait', text: 'Received. Awaiting confirmation; only you can see it until then.' };
      if (r.result === 'processing' || r.status === 'retry') return { tone: 'wait', text: 'Received. The reader is busy, so it will be processed shortly. We will tell you when it is done.' };
      return { tone: 'bad', text: `Not listed. ${reasonText(r.reason)}` };
    }
    case 'link_failed': return { tone: 'bad', text: LINK_FAILED_MESSAGE };
    case 'no_text': return { tone: 'bad', text: 'No readable text was found on that image. Try a clearer screenshot.' };
    case 'too_long': return { tone: 'bad', text: 'There is too much text to be a single flyer.' };
    case 'unavailable': return { tone: 'bad', text: 'Reading flyers is not available on this phone.' };
    default: return { tone: 'bad', text: o.message };
  }
}

export default function FlyerScreen() {
  const params = useLocalSearchParams<{ uris?: string; url?: string; text?: string }>();
  const metro = useApp((s) => s.filters.place?.metro);
  const intakeOn = useFlag('flyer_intake_enabled');
  const flagsLoaded = useFlags((s) => s.loaded);
  const [phase, setPhase] = useState<'start' | 'terms' | 'running' | 'done' | 'failed'>('start');
  const [account, setAccount] = useState<{ id: string; anonymous: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [termsError, setTermsError] = useState<string | null>(null);
  const started = useRef(false);

  const inputs = useRef(
    (() => {
      let uris: string[] = [];
      try {
        const p = params.uris ? JSON.parse(params.uris) : [];
        if (Array.isArray(p)) uris = p.filter((x): x is string => typeof x === 'string').slice(0, 5);
      } catch { /* none */ }
      return { uris, url: params.url || '', text: params.text || '' };
    })(),
  ).current;

  const run = useCallback(async () => {
    const list: Item[] = [
      ...inputs.uris.map((u, i) => ({ key: `img${i}`, label: inputs.uris.length > 1 ? `Flyer ${i + 1}` : 'Flyer', state: 'waiting' as const, uri: u })),
      ...(inputs.url && !inputs.uris.length ? [{ key: 'link', label: 'Link', state: 'waiting' as const }] : []),
      ...(!inputs.url && !inputs.uris.length && inputs.text ? [{ key: 'text', label: 'Text', state: 'waiting' as const }] : []),
    ];
    setItems(list);
    setPhase('running');
    track('flyer_shared', { kind: inputs.uris.length ? 'image' : inputs.url ? 'link' : 'text', count: Math.max(1, inputs.uris.length) });
    const update = (key: string, patch: Partial<Item>) => setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
    for (const it of list as (Item & { uri?: string })[]) {
      update(it.key, { state: 'working' });
      let o: Outcome;
      if (it.key.startsWith('img') && it.uri) {
        const read = await readFlyerImage(it.uri, deps);
        o = 'prepared' in read ? await sendPrepared(read.prepared, metro, 'image', deps) : read;
        if (o.kind === 'submitted' && o.reply.jobId) useFlyers.getState().rememberImage(o.reply.jobId, it.uri);
      } else if (it.key === 'link') {
        o = await handleLink(inputs.url, metro, deps, async () => true);
        if (o.kind === 'submitted' && o.reply.jobId && o.imageUri) useFlyers.getState().rememberImage(o.reply.jobId, o.imageUri);
      } else {
        o = await handleText(inputs.text, metro, deps);
      }
      update(it.key, { state: 'done', outcome: o });
    }
    setPhase('done');
    useListings.getState().refreshFirstParty();
    useFlyers.getState().poll();
  }, [inputs, metro]);

  // Step 1: an account (anonymous if the person never signed in) and one-tap Terms acceptance.
  useEffect(() => {
    const gate = intakeGate(flagsLoaded, intakeOn);
    if (started.current || gate === 'wait') return;
    started.current = true;
    // flyer_intake_enabled off: no sign-in, no OCR, no server contact.
    if (gate === 'paused') return;
    (async () => {
      const a = await useAuth.getState().ensureAccount();
      if ('error' in a) {
        setErr(a.error);
        setPhase('failed');
        return;
      }
      setAccount(a);
      const t = await fetchTermsAccepted(a.id, TERMS_VERSION);
      if (t.ok && t.data) run();
      else setPhase('terms');
    })();
  }, [run, flagsLoaded, intakeOn]);

  const accept = async () => {
    setTermsError(null);
    const r = await acceptTerms(TERMS_VERSION);
    if (!r.ok) {
      setTermsError(r.error);
      return false;
    }
    run();
    return true;
  };

  // "Received" means the server accepted it for review; flyers that were read but not listed get the reason instead.
  const received = items.some((i) => i.outcome?.kind === 'submitted' && (i.outcome.reply.result === 'published' || i.outcome.reply.result === 'pending' || i.outcome.reply.result === 'processing' || i.outcome.reply.status === 'retry'));
  const failedLink = items.find((i) => i.outcome?.kind === 'link_failed');

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Share a flyer</Text>
      <Text style={styles.body}>Setnik reads the text on your phone. The picture itself is never uploaded.</Text>

      {!intakeOn && flagsLoaded ? (
        <View style={styles.card}>
          <Text style={styles.body}>{FLYER_PAUSED_MESSAGE}</Text>
          <Pressable style={styles.secondary} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </View>
      ) : null}
      {phase === 'start' && intakeOn ? <ActivityIndicator color={C.accent} /> : null}
      {phase === 'failed' ? <Text style={styles.err}>{err}</Text> : null}
      {phase === 'terms' ? (
        <TermsGate
          onAccept={accept}
          error={termsError}
          note={account?.anonymous ? 'You do not need an account. Sharing without signing in has a lower daily limit.' : undefined}
        />
      ) : null}

      {items.map((it) => {
        const d = it.outcome ? describe(it.outcome) : null;
        return (
          <View key={it.key} style={styles.card}>
            <Text style={styles.cardTitle}>{it.label}</Text>
            {it.state === 'working' ? (
              <View style={styles.row}>
                <ActivityIndicator color={C.accent} />
                <Text style={styles.body}>Reading and sending…</Text>
              </View>
            ) : it.state === 'waiting' ? (
              <Text style={styles.body}>Waiting</Text>
            ) : d ? (
              <Text style={[styles.body, d.tone === 'bad' ? { color: C.warn } : { color: C.text }]}>{d.text}</Text>
            ) : null}
          </View>
        );
      })}

      {phase === 'done' && received ? (
        <View style={styles.thanks}>
          <Text style={styles.thanksTitle}>{THANKS_TITLE}</Text>
          <Text style={styles.thanksBody}>{THANKS_BODY}</Text>
          <Text style={styles.body}>{CONFIRMATION_RULES}</Text>
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={() => router.replace('/(tabs)/going')} accessibilityRole="button">
            <Text style={styles.primaryText}>See my submissions</Text>
          </Pressable>
          {failedLink && account && !account.anonymous ? (
            <Pressable style={styles.secondary} onPress={() => router.replace({ pathname: '/submit', params: { url: inputs.url, text: inputs.text } })} accessibilityRole="button">
              <Text style={styles.secondaryText}>Add the details by hand</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondary} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        </View>
      ) : null}
      {phase === 'failed' ? (
        <Pressable style={styles.secondary} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.secondaryText}>Close</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 12 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 20 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 14, lineHeight: 20 },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 14 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 6 },
  cardTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thanks: { borderWidth: 1, borderColor: C.accent, borderRadius: 12, padding: 14, gap: 8 },
  thanksTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 18 },
  thanksBody: { fontFamily: F.ui, color: C.text, fontSize: 14, lineHeight: 20 },
  actions: { gap: 10, marginTop: 6 },
  primary: { height: 46, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
  secondary: { height: 46, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: F.ui, color: C.text, fontSize: 14 },
});
