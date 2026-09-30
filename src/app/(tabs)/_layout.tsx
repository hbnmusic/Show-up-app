import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useMemo } from 'react';

import { C, F } from '@/constants/theme';
import { useListings } from '@/lib/listingsStore';
import { useApp } from '@/lib/store';
import { sameDay } from '@/lib/time';

export default function TabsLayout() {
  const decisions = useApp((s) => s.decisions);
  const byId = useListings((s) => s.byId);
  const tonightCount = useMemo(() => {
    const now = new Date();
    return Object.entries(decisions).filter(([id, d]) => {
      const s = byId[id];
      return d.decision === 'going' && s && sameDay(new Date(s.startsAt), now) && s.status !== 'cancelled';
    }).length;
  }, [decisions, byId]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.line },
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.faint,
        tabBarLabelStyle: { fontFamily: F.ui, fontSize: 11, lineHeight: 14 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Shows',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="going"
        options={{
          title: 'Going',
          tabBarBadge: tonightCount > 0 ? tonightCount : undefined,
          tabBarBadgeStyle: { backgroundColor: C.accent, color: C.accentInk, fontFamily: F.uiBold },
          tabBarIcon: ({ color, size }) => <Ionicons name="ticket" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
