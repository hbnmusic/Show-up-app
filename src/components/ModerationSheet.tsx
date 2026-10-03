import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { blockUser, reportSubmission, reportUser } from '@/lib/community/api';
import { COMMUNITY_PREFIX } from '@/lib/community/form';
import { useListings } from '@/lib/listingsStore';
import { REPORT_REASONS } from '@/lib/legal';
import type { Show } from '@/lib/types';

type Step = { kind: 'menu' } | { kind: 'reason'; what: 'show' | 'user' } | { kind: 'block' } | { kind: 'done'; title: string; text: string } | { kind: 'error'; text: string };

/**
 * Report this show, report the person who added it, or block them. Every action ends with an acknowledgement.
 * `show` must be a community show (id starts with COMMUNITY_PREFIX).
 */
export function ModerationSheet({ show, onClose }: { show: Show | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [busy, setBusy] = useState(false);
  const close = () => {
    setStep({ kind: 'menu' });
    onClose();
  };
  if (!show) return null;
  const sid = show.id.startsWith(COMMUNITY_PREFIX) ? show.id.slice(COMMUNITY_PREFIX.length) : undefined;
  const author = show.source.author;

  const send = async (what: 'show' | 'user', reason: string) => {
    setBusy(true);
    const res =
      what === 'show' || !author ? await reportSubmission(sid ?? '', reason) : await reportUser(author, reason, sid);
    setBusy(false);
    if (!res.ok) return setStep({ kind: 'error', text: res.error });
    setStep({
      kind: 'done',
      title: 'Report received',
      text:
        what === 'show'
          ? 'Thank you. Your report was recorded. Three reports take a show down, and we review reports in the order they arrive.'
          : 'Thank you. Your report about this person was recorded. We review reports and may remove content or accounts that break the rules.',
    });
  };

  const block = async () => {
    if (!author) return;
    setBusy(true);
    const res = await blockUser(author);
    setBusy(false);
    if (!res.ok) return setStep({ kind: 'error', text: res.error });
    await useListings.getState().refreshCommunity(show.venue.metro ? [show.venue.metro] : []);
    setStep({ kind: 'done', title: 'Person blocked', text: 'You will no longer see shows this person adds. You can unblock them under Community shows.' });
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        {step.kind === 'menu' ? (
          <>
            <Text style={styles.title}>Report or block</Text>
            <Row label="Report this show" onPress={() => setStep({ kind: 'reason', what: 'show' })} />
            {author ? <Row label="Report the person who added it" onPress={() => setStep({ kind: 'reason', what: 'user' })} /> : null}
            {author ? <Row label="Block this person" onPress={() => setStep({ kind: 'block' })} /> : null}
          </>
        ) : null}
        {step.kind === 'reason' ? (
          <>
            <Text style={styles.title}>{step.what === 'show' ? 'Why report this show?' : 'Why report this person?'}</Text>
            {REPORT_REASONS.map((r) => (
              <Row key={r} label={r} disabled={busy} onPress={() => send(step.what, r)} />
            ))}
          </>
        ) : null}
        {step.kind === 'block' ? (
          <>
            <Text style={styles.title}>Block this person?</Text>
            <Text style={styles.body}>Their shows will be hidden from you. They are not told.</Text>
            <Row label="Block" danger disabled={busy} onPress={block} />
          </>
        ) : null}
        {step.kind === 'done' ? (
          <>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.text}</Text>
          </>
        ) : null}
        {step.kind === 'error' ? (
          <>
            <Text style={styles.title}>That did not work</Text>
            <Text style={styles.body}>{step.text}</Text>
          </>
        ) : null}
        <Pressable style={styles.cancel} onPress={close} accessibilityRole="button">
          <Text style={styles.cancelText}>{step.kind === 'done' || step.kind === 'error' ? 'Done' : 'Cancel'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Row({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={[styles.rowText, danger && { color: C.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 14, gap: 4 },
  title: { fontFamily: F.uiBold, color: C.text, fontSize: 16, marginBottom: 6 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  row: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.line },
  rowText: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  cancel: { marginTop: 6, height: 44, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: F.ui, color: C.text, fontSize: 14 },
});
