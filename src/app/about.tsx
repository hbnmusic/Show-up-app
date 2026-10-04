import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/constants/theme';
import { communityEnabled } from '@/lib/communityConfig';
import { DELETE_ACCOUNT_URL, PRIVACY_URL, SUPPORT_EMAIL, SUPPORT_MAILTO, TERMS_URL } from '@/lib/legal';
import { useFlag } from '@/lib/flags';
import { useListings } from '@/lib/listingsStore';

const open = (url: string) => Linking.openURL(url).catch(() => {});

export default function AboutScreen() {
  const attribution = useListings((s) => s.attribution);
  const jambaseOn = useFlag('jambase_enabled');
  const deezerOn = useFlag('deezer_enabled');
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.name}>Pull Up</Text>
      <Text style={styles.sub}>Version {Constants.expoConfig?.version ?? "1.0.0"} · For ages 18 and up</Text>

      <Text style={styles.section}>HELP AND POLICIES</Text>
      <View style={styles.card}>
        <LinkRow label="Support" detail={SUPPORT_EMAIL} onPress={() => open(SUPPORT_MAILTO)} />
        {communityEnabled ? <LinkRow label="Send feedback or report a bug" onPress={() => router.push('/feedback')} /> : null}
        <LinkRow label="Privacy Policy" onPress={() => open(PRIVACY_URL)} />
        <LinkRow label="Terms of Use" onPress={() => open(TERMS_URL)} />
        <LinkRow label="Delete your account (web)" onPress={() => open(DELETE_ACCOUNT_URL)} last />
      </View>

      <Text style={styles.section}>DATA SOURCES AND CREDITS</Text>
      <View style={styles.card}>
        <Text style={styles.body}>
          Show listings come from {jambaseOn ? 'JamBase, from ' : ''}venues&apos; own public event pages, and from people who share flyers or add shows in the app. Listings are
          informational; check the ticket page before you go.
        </Text>
        {attribution.length ? <Text style={[styles.body, { paddingTop: 0 }]}>{attribution.join('\n')}</Text> : null}
        <Text style={[styles.body, { paddingTop: 0 }]}>
          {jambaseOn ? 'Show data: JamBase (jambase.com). ' : ''}Where a card shows a flyer or event photo, it is the image on the venue&apos;s own
          page or a flyer you shared, and it belongs to its owner. Tap {jambaseOn ? 'View on JamBase or ' : ''}Open listing on a show to go to
          the original page.
        </Text>
        {deezerOn ? (
          <Text style={[styles.body, { paddingTop: 0 }]}>
            30-second audio previews and artist photos: Deezer public API (deezer.com). Previews are for personal,
            non-commercial listening. Deezer is not affiliated with Pull Up.
          </Text>
        ) : null}
        <Text style={[styles.body, { paddingTop: 0 }]}>
          Community accounts and community-added shows are hosted with Supabase (supabase.com).
        </Text>
        <Text style={[styles.body, { paddingTop: 0 }]}>
          Typefaces: Anton, Archivo Black, Space Grotesk and Space Mono, used under the SIL Open Font License through
          Google Fonts. Icons: Ionicons (MIT).
        </Text>
        <Text style={[styles.body, { paddingTop: 0 }]}>
          All other names and logos belong to their owners; their use here does not imply endorsement.
        </Text>
      </View>
    </ScrollView>
  );
}

function LinkRow({ label, detail, onPress, last }: { label: string; detail?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, !last && styles.rowLine]} onPress={onPress} accessibilityRole="link">
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  name: { fontFamily: F.block, color: C.text, fontSize: 28 },
  sub: { fontFamily: F.mono, color: C.faint, fontSize: 12 },
  section: { fontFamily: F.monoBold, color: C.faint, fontSize: 11, letterSpacing: 1.5, marginTop: 12 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 13 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  label: { fontFamily: F.ui, color: C.text, fontSize: 15 },
  detail: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12, marginTop: 1 },
  body: { fontFamily: F.uiRegular, color: C.muted, fontSize: 13, lineHeight: 19, padding: 14 },
});
