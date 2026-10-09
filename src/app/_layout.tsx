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
import { DarkTheme, Stack, ThemeProvider, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { C } from '@/constants/theme';
import { initAnalytics } from '@/lib/analytics';
import { runFlagEffects } from '@/lib/flagEffects';
import { useFlags } from '@/lib/flags';
import { clearPreviews } from '@/lib/previews';
import { cancelRetentionNotifications } from '@/lib/retention/cancel';
import { noteSeen, onForeground, onNotificationTapped, syncRetentionTask } from '@/lib/retention/service';
import { track } from '@/lib/analyticsCore';
import { useAuth } from '@/lib/auth';
import { extractUrl } from '@/lib/community/form';
import { initPlace } from '@/lib/location';
import { useFlyers } from '@/lib/flyer/store';
import { useListings } from '@/lib/listingsStore';
import { flushNow, resendAfterFlagOn, startGoingWatcher } from '@/lib/going/service';
import { useGoing } from '@/lib/going/store';
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
      // "New shows" and "Shows tonight" notifications open the deck set up for them (see lib/retention).
      if (onNotificationTapped(n.request.identifier, n.request.content.data as Record<string, unknown> | undefined, n.date)) {
        try {
          router.navigate('/' as never);
        } catch {
          // The deck is the first screen anyway when the app starts from the notification.
        }
        return;
      }
      const url = n.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) go(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => go(r.notification));
    return () => sub.remove();
  }, []);
}

/** A post or link shared to Setnik from another app (Instagram's Share button, a browser) opens the add-a-show form. */
/** Records which screens people open (the screen name only, never a show id). */
function ScreenTracker() {
  const pathname = usePathname();
  useEffect(() => {
    track('screen_view', { screen: pathname.startsWith('/show/') ? '/show' : pathname });
  }, [pathname]);
  return null;
}

function ShareRouter() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const images = (shareIntent.files ?? []).filter((f) => (f.mimeType ?? '').startsWith('image/')).map((f) => f.path);
    const text = shareIntent.text ?? shareIntent.webUrl ?? '';
    const url = shareIntent.webUrl ?? extractUrl(text);
    resetShareIntent();
    track('share_received');
    if (!communityEnabled) return;
    // Images, or a link or text, go to the flyer reader. It offers the manual form if a link cannot be read.
    if (images.length || url || text) router.push({ pathname: '/flyer', params: { uris: JSON.stringify(images), url: images.length ? '' : (url ?? ''), text: images.length ? '' : text } });
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
    useFlyers.getState().load();
  }, []);

  // Kill switches: read the saved values at launch, then fetch (at most every 15 minutes, also when the app returns to the front).
  useEffect(() => {
    const apply = () =>
      runFlagEffects(useFlags.getState().flags, {
        recombine: () => useListings.getState().recombine(),
        clearDeezer: async () => {
          clearPreviews();
          await Image.clearMemoryCache().catch(() => {});
          await Image.clearDiskCache().catch(() => {});
        },
        cancelNotifications: async () => void (await cancelRetentionNotifications()),
        getMarker: async () => (await AsyncStorage.getItem('setnik-deezer-cleared-v1').catch(() => null)) === '1',
        setMarker: (v) => AsyncStorage.setItem('setnik-deezer-cleared-v1', v ? '1' : '0').catch(() => {}),
      }).catch(() => {});
    const refresh = () => useFlags.getState().refresh().then((changed) => (changed ? apply() : undefined));
    useFlags.getState().load().then(async () => {
      await apply();
      await refresh();
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, []);

  // Retention notifications: count this open, keep the "new shows" baseline, and keep the background task in step with the
  // switches. After the flags are read (and again when they change) the task is registered or removed.
  const flagsLoaded = useFlags((s) => s.loaded);
  const notifFlag = useFlags((s) => s.flags.notifications_enabled.enabled);
  useEffect(() => {
    if (!hydrated) return;
    onForeground().then(() => syncRetentionTask()).catch(() => {});
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') onForeground().then(() => syncRetentionTask()).catch(() => {});
      else noteSeen({ background: true });
    });
    return () => sub.remove();
  }, [hydrated]);
  useEffect(() => {
    if (hydrated && flagsLoaded) syncRetentionTask().catch(() => {});
  }, [hydrated, flagsLoaded, notifFlag]);

  // Going counts: read the saved id and switch, watch the Going list once the saved decisions are loaded, send what is queued
  // when the app returns to the front, and send the Going list again if the kill switch comes back on after being off.
  const goingFlag = useFlags((s) => s.flags.going_counts_enabled?.enabled !== false);
  const goingLoaded = useGoing((s) => s.loaded);
  const lastGoingFlag = useRef<boolean | null>(null);
  useEffect(() => {
    useGoing.getState().load().catch(() => {});
  }, []);
  useEffect(() => {
    if (!hydrated || !goingLoaded) return;
    const stop = startGoingWatcher();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') flushNow();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [hydrated, goingLoaded]);
  useEffect(() => {
    if (!hydrated || !goingLoaded || !flagsLoaded) return;
    if (lastGoingFlag.current === false && goingFlag) resendAfterFlagOn();
    lastGoingFlag.current = goingFlag;
  }, [hydrated, goingLoaded, flagsLoaded, goingFlag]);

  // Check shared flyers for results now and whenever the app comes to the front (local notices only; there is no push service).
  useEffect(() => {
    const check = () => useFlyers.getState().poll().then((jobs) => (jobs.some((j) => j.result === 'published') ? useListings.getState().refreshFirstParty() : undefined));
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }, []);

  useEffect(() => {
    initAnalytics();
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
      noteSeen({ background: false }); // first look at a city records the baseline for "new shows"
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
        <ScreenTracker />
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
          <Stack.Screen name="feedback" options={{ title: 'Send feedback' }} />
          <Stack.Screen name="about" options={{ title: 'About and credits' }} />
          <Stack.Screen name="community" options={{ title: 'Community shows' }} />
          <Stack.Screen name="submit" options={{ presentation: 'modal', title: 'Add a show' }} />
          <Stack.Screen name="flyer" options={{ presentation: 'modal', title: 'Share a flyer' }} />
          <Stack.Screen name="flyers" options={{ title: 'My flyers' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
