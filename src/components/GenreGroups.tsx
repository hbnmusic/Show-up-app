import { StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { C, F } from '@/constants/theme';
import { groupGenres, type Genre } from '@/lib/types';

/** Genre chips under bucket headings. `available` limits which genres are shown (selected ones always stay). */
export function GenreGroups({
  selected,
  onToggle,
  available,
}: {
  selected: readonly Genre[];
  onToggle: (g: Genre) => void;
  available?: ReadonlySet<Genre>;
}) {
  const groups = groupGenres((g) => !available || available.has(g) || selected.includes(g));
  if (groups.length === 0) return <Text style={styles.empty}>No genres listed yet.</Text>;
  return (
    <View style={styles.wrap}>
      {groups.map((grp) => (
        <View key={grp.title} style={styles.group}>
          <Text style={styles.title}>{grp.title}</Text>
          <View style={styles.chips}>
            {grp.genres.map((g) => (
              <Chip key={g} label={g} on={selected.includes(g)} onPress={() => onToggle(g)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, alignSelf: 'stretch' },
  group: { gap: 6 },
  title: { fontFamily: F.uiBold, color: C.faint, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { fontFamily: F.uiRegular, color: C.faint, fontSize: 13 },
});
