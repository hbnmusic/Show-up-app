import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SignIn } from '@/components/SignIn';
import { C, F } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import {
  confirmSubmission,
  fetchMine,
  fetchQueue,
  reportSubmission,
  withdrawSubmission,
} from '@/lib/community/api';
import { rowToShow, type SubmissionRow } from '@/lib/community/form';
import { useListings } from '@/lib/listingsStore';
import { metroById, DEFAULT_METRO } from '@/lib/metros';
import { dateTimeLabel, showTitle } from '@/lib/showText';
import { useApp } from '@/lib/store';
import { communityEnabled } from '@/lib/communityConfig';

export default function CommunityScreen() {
  const userId = useAuth((s) => s.userId);
  const email = useAuth((s) => s.email);
  const signOut = useAuth((s) => s.signOut);
  const metroId = useApp((s) => s.filters.place?.metro) ?? DEFAULT_METRO.id;
  const metro = metroById(metroId) ?? DEFAULT_METRO;
  const [queue, setQueue] = useState<SubmissionRow[] | null>(null);
  const [mine, setMine] = useState<SubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    Promise.all([fetchQueue(userId, metro.id), fetchMine(userId)]).then(([q, m]) => {
      if (!live) return;
      setQueue(q.ok ? q.data : null);
      setMine(m.ok ? m.data : null);
      setError(!q.ok ? q.error : !m.ok ? m.error : null);
    });
    return () => {
      live = false;
    };
  }, [userId, metro.id, reload]);

  if (!communityEnabled) {
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>Community listings are not set up in this build.</Text>
      </View>
    );
  }

  const act = async (id: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusyId(id);
    const res = await run();
    setBusyId(null);
    if (!res.ok) Alert.alert('That did not work', res.error);
    setReload((n) => n + 1);
    await useListings.getState().refreshCommunity([metro.id]);
  };

  const withdraw = (r: SubmissionRow) =>
    Alert.alert('Remove this show?', 'It will no longer be listed for anyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => act(r.id, () => withdrawSubmission(r.id)) },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        {userId ? (
          <View style={styles.accountRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Signed in</Text>
              <Text style={styles.detail}>{email}</Text>
            </View>
            <Pressable onPress={() => signOut()} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <SignIn />
        )}
      </View>

      {userId ? (
        <>
          <Pressable style={styles.add} onPress={() => router.push('/submit')} accessibilityRole="button">
            <Text style={styles.addText}>Add a show</Text>
          </Pressable>
          <Text style={styles.help}>
            Missing a show? Add it here, or share an Instagram post or ticket link to Pull Up. It appears for everyone once
            a second person confirms it.
          </Text>

          <Text style={styles.section}>NEEDS A SECOND LOOK · {metro.name.toUpperCase()}</Text>
          {queue === null && !error ? <ActivityIndicator color={C.muted} /> : null}
          {queue?.length === 0 ? <Text style={styles.empty}>Nothing waiting in {metro.name}.</Text> : null}
          {queue?.map((r) => {
            const s = rowToShow(r);
            if (!s) return null;
            return (
              <View key={r.id} style={styles.card}>
                <View style={styles.item}>
                  <Text style={styles.itemTitle}>{showTitle(s)}</Text>
                  <Text style={styles.detail}>
                    {s.venue.name} · {s.venue.area}
                  </Text>
                  <Text style={styles.detail}>{dateTimeLabel(s)}</Text>
                  {r.source_url || r.ticket_url ? (
                    <Pressable onPress={() => Linking.openURL((r.ticket_url ?? r.source_url)!)} hitSlop={6}>
                      <Text style={styles.link}>Open the link they added</Text>
                    </Pressable>
                  ) : null}
                  <View style={styles.btnRow}>
                    <Pressable
                      style={[styles.btn, styles.btnPrimary]}
                      disabled={busyId === r.id}
                      onPress={() => act(r.id, () => confirmSubmission(r.id))}
                      accessibilityRole="button">
                      <Text style={styles.btnPrimaryText}>Looks right</Text>
                    </Pressable>
                    <Pressable
                      style={styles.btn}
                      disabled={busyId === r.id}
                      onPress={() => act(r.id, () => reportSubmission(r.id, 'queue'))}
                      accessibilityRole="button">
                      <Text style={styles.btnText}>Not right</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
          {queue && queue.length > 0 ? (
            <Text style={styles.help}>Confirm only a show you know is real, for example from the venue or ticket page.</Text>
          ) : null}

          <Text style={styles.section}>YOUR SUBMISSIONS</Text>
          {mine?.length === 0 ? <Text style={styles.empty}>You have not added a show yet.</Text> : null}
          {mine?.map((r) => {
            const s = rowToShow(r);
            if (!s) return null;
            return (
              <View key={r.id} style={styles.card}>
                <View style={styles.item}>
                  <Text style={styles.itemTitle}>{showTitle(s)}</Text>
                  <Text style={styles.detail}>
                    {s.venue.name} · {dateTimeLabel(s)}
                  </Text>
                  <Text style={[styles.status, r.status === 'live' && { color: C.good }]}>
                    {r.status === 'live' ? 'Live for everyone' : 'Waiting for a second person to confirm'}
                  </Text>
                  <Pressable onPress={() => withdraw(r)} hitSlop={6} disabled={busyId === r.id}>
                    <Text style={styles.linkDanger}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {error ? <Text style={styles.err}>{error}</Text> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  item: { padding: 14, gap: 3 },
  itemTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 16 },
  label: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  detail: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 14, padding: 20 },
  section: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.5, marginTop: 12 },
  help: { fontFamily: F.uiRegular, color: C.faint, fontSize: 12, lineHeight: 17 },
  empty: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13 },
  link: { fontFamily: F.ui, color: C.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 4 },
  linkDanger: { fontFamily: F.ui, color: C.danger, fontSize: 13, marginTop: 6 },
  status: { fontFamily: F.ui, color: C.warn, fontSize: 12, marginTop: 4 },
  err: { fontFamily: F.ui, color: C.warn, fontSize: 13 },
  add: { height: 48, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  addText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 15 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { paddingHorizontal: 16, height: 40, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: F.ui, color: C.text, fontSize: 14 },
  btnPrimary: { backgroundColor: C.text, borderColor: C.text },
  btnPrimaryText: { fontFamily: F.uiBold, color: C.bg, fontSize: 14 },
});
