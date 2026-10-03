import { Anton_400Regular } from '@expo-google-fonts/anton';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { setAudioModeAsync } from 'expo-audio';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { DarkTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { C } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { extractUrl } from '@/lib/community/form';
import { initPlace } from '@/lib/location';
import { useListings } from '@/lib/listingsStore';
import { syncReminders } from '@/lib/reminders';
import { useApp } from '@/lib/store';
import { communityEnabled } from '@/lib/communityConfig';

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, text: C.text, border: C.line, primary: C.accent },
};

/** Open the show a reminder is about when it's tapped. */
function useNotificationRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const go = (n: Notifications.Notification) => {
      const url = n.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) go(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => go(r.notification));
    return () => sub.remove();
  }, []);
}

/** A post or link shared to Pull Up from another app (Instagram's Share button, a browser) opens the add-a-show form. */
function ShareRouter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const text = shareIntent.text ?? shareIntent.webUrl ?? '';
    const url = shareIntent.webUrl ?? extractUrl(text);
    resetShareIntent();
    if (communityEnabled && (url || text)) router.push({ pathname: '/submit', params: { url: url ?? '', text } });
  }, [hasShareIntent, shareIntent, resetShareIntent]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    ArchivoBlack_400Regular,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });
  const hydrated = useApp((s) => s.hydrated);
  const listingsReady = useListings((s) => s.ready);
  const placeMetro = useApp((s) => s.filters.place?.metro);

  useNotificationRouting();

  useEffect(() => {
    useAuth.getState().init();
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }, []);

  // First launch: centre the deck on the phone's location (falls back to New York).
  useEffect(() => {
    if (hydrated) initPlace();
  }, [hydrated]);

  // Read the saved listings once the saved decisions are loaded.
  useEffect(() => {
    if (hydrated) useListings.getState().loadCache();
  }, [hydrated]);

  // On launch and whenever the app returns to the front: look for fresh listings
  // (at most every 30 minutes), then rebuild reminders so changed times are picked up.
  useEffect(() => {
    // Wait for a city: the first launch picks one from the phone's location. Changing city downloads that city.
    if (!hydrated || !listingsReady || !placeMetro) return;
    const run = async () => {
      await syncReminders();
      if (await useListings.getState().refresh()) await syncReminders();
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [hydrated, listingsReady, placeMetro]);

  const ready = fontsLoaded && hydrated && listingsReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <ShareIntentProvider>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <ShareRouter />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.text,
            headerTitleStyle: { fontFamily: 'SpaceGrotesk_700Bold' },
            contentStyle: { backgroundColor: C.bg },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="show/[id]" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="filters" options={{ presentation: 'modal', title: 'Filters' }} />
          <Stack.Screen name="cities" options={{ presentation: 'modal', title: 'Choose a city' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="about" options={{ title: 'About and credits' }} />
          <Stack.Screen name="community" options={{ title: 'Community shows' }} />
          <Stack.Screen name="submit" options={{ presentation: 'modal', title: 'Add a show' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
