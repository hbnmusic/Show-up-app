import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { deleteMyAccount } from '@/lib/community/api';
import { confirmFpShow, fetchConfirmQueue, reportFpShow, type QueueItem } from '@/lib/fp/api';
import { canAddByHand, viewJob } from '@/lib/flyer/status';
import { useFlyers } from '@/lib/flyer/store';
import { useListings } from '@/lib/listingsStore';
import { DEFAULT_METRO } from '@/lib/metros';
import { useApp } from '@/lib/store';
import { DELETE_ACCOUNT_URL } from '@/lib/legal';

export default function FlyersScreen() {
  const jobs = useFlyers((s) => s.jobs);
  const userId = useAuth((s) => s.userId);
  const anonId = useAuth((s) => s.anonId);
  const metro = useApp((s) => s.filters.place?.metro) ?? DEFAULT_METRO.id;
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    await useFlyers.getState().poll();
    if (userId) {
      const q = await fetchConfirmQueue(metro);
      setQueue(q.ok ? q.data : []);
    }
    setRefreshing(false);
  };
  useEffect(() => {
    let live = true;
    (async () => {
      await useFlyers.getState().poll();
      if (!userId) return;
      const q = await fetchConfirmQueue(metro);
      if (live) setQueue(q.ok ? q.data : []);
    })();
    return () => {
      live = false;
    };
  }, [userId, metro]);

  const act = async (id: string, f: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    const r = await f();
    setBusy(null);
    if (!r.ok) return Alert.alert('Could not do that', r.error ?? 'Try again.');
    setQueue((q) => (q ? q.filter((x) => x.id !== id) : q));
    useListings.getState().refreshFirstParty([metro]);
  };

  const deleteData = () =>
    Alert.alert('Delete my flyer data?', 'This deletes your flyer records and the shows only you supplied, and signs this account out.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const r = await deleteMyAccount();
          if (!r.ok) return Alert.alert('Could not delete', `${r.error}\n\nYou can also request deletion at ${DELETE_ACCOUNT_URL}`);
          await useAuth.getState().signOut();
          await useFlyers.getState().clear();
          useListings.getState().refreshFirstParty([metro]);
          Alert.alert('Deleted', 'Your flyer data was deleted.');
        },
      },
    ]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={C.accent} />}>
      <Text style={styles.title}>My flyers</Text>
      {jobs.length === 0 ? (
        <Text style={styles.body}>Nothing shared yet. In Instagram or your gallery, tap Share and choose Setnik.</Text>
      ) : (
        jobs.map((j) => {
          const v = viewJob(j);
          return (
            <View key={j.id} style={styles.card}>
              <Text style={[styles.cardTitle, v.tone === 'no' ? { color: C.warn } : null]}>{v.title}</Text>
              <Text style={styles.body}>{v.detail}</Text>
              {v.tone === 'no' && canAddByHand(j.reason) ? (
                <Pressable style={styles.secondary} onPress={() => router.push('/submit')} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Add the details by hand</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      {userId ? (
        <>
          <Text style={[styles.title, { marginTop: 14 }]}>Help confirm</Text>
          <Text style={styles.body}>Flyer shows other people shared in your city that need a second person to confirm they are real. Only confirm what you know.</Text>
          {queue === null ? <ActivityIndicator color={C.accent} /> : queue.length === 0 ? <Text style={styles.body}>Nothing waiting right now.</Text> : null}
          {(queue ?? []).map((q) => (
            <View key={q.id} style={styles.card}>
              <Text style={styles.cardTitle}>{[q.headliner, ...(q.supports ?? [])].join(', ')}</Text>
              <Text style={styles.body}>{q.venueName}{q.city ? `, ${q.city}` : ''} · {q.localDate}{q.startLocal ? ` · ${q.startLocal}` : ''}</Text>
              <View style={styles.row}>
                <Pressable style={styles.primary} disabled={busy === q.id} onPress={() => act(q.id, () => confirmFpShow(q.id))} accessibilityRole="button">
                  <Text style={styles.primaryText}>Yes, this is real</Text>
                </Pressable>
                <Pressable style={styles.secondary} disabled={busy === q.id} onPress={() => act(q.id, () => reportFpShow(q.id))} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Report</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.body}>Sign in with your email (Community shows) to help confirm other people&apos;s flyers.</Text>
      )}

      {userId || anonId ? (
        <Pressable style={[styles.secondary, { marginTop: 18 }]} onPress={deleteData} accessibilityRole="button">
          <Text style={styles.secondaryText}>Delete my flyer data</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 20 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 6 },
  cardTitle: { fontFamily: F.uiBold, color: C.text, fontSize: 14 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primary: { flex: 1, height: 40, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: F.uiBold, color: C.accentInk, fontSize: 13 },
  secondary: { height: 40, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: F.ui, color: C.text, fontSize: 13 },
});
