/**
 * What the phone remembers about shared flyers: the local image address for each (the image stays on the phone), and
 * the latest job statuses. Notifications are local only; there is no push service, so a notice appears the next time the
 * app is open and checks.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { fetchMyJobs, markNotified, type Job } from '../fp/api';
import { useAuth } from '../auth';
import { REMINDER_CHANNEL } from '../reminders';
import { noticesFor } from './status';

const KEY = 'setnik-flyers-v1';

type Saved = { images: Record<string, string>; pendingImages: Record<string, string> };

type FlyerState = {
  loaded: boolean;
  jobs: Job[];
  /** fp show id → local image address (a file on this phone or the shared post's picture address). */
  images: Record<string, string>;
  /** job id → image address, held until the job reports its show ids. */
  pendingImages: Record<string, string>;
  load: () => Promise<void>;
  rememberImage: (jobId: string, uri: string) => void;
  poll: () => Promise<Job[]>;
  clear: () => Promise<void>;
};

const persist = (s: Saved) => AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});

export const useFlyers = create<FlyerState>()((set, get) => ({
  loaded: false,
  jobs: [],
  images: {},
  pendingImages: {},

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
      set({ images: p.images ?? {}, pendingImages: p.pendingImages ?? {}, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  rememberImage: (jobId, uri) => {
    const pendingImages = { ...get().pendingImages, [jobId]: uri };
    set({ pendingImages });
    persist({ images: get().images, pendingImages });
  },

  poll: async () => {
    const auth = useAuth.getState();
    if (!auth.userId && !auth.anonId) return [];
    const r = await fetchMyJobs();
    if (!r.ok) return get().jobs;
    const jobs = r.data;
    // Attach the held image to the show(s) the job produced.
    const images = { ...get().images };
    const pendingImages = { ...get().pendingImages };
    for (const j of jobs) {
      const uri = pendingImages[j.id];
      if (!uri || !j.shows.length) continue;
      for (const s of j.shows) images[s.id] = uri;
      delete pendingImages[j.id];
    }
    set({ jobs, images, pendingImages });
    persist({ images, pendingImages });

    const notices = noticesFor(jobs);
    if (notices.length && Platform.OS !== 'web') {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (perm.granted) {
          for (const n of notices) {
            await Notifications.scheduleNotificationAsync({
              content: { title: n.title, body: n.body, data: { url: '/flyers' }, ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL } : {}) },
              trigger: null,
            });
          }
        }
      } catch {
        // A failed notice is not worth blocking the status update.
      }
      await markNotified(notices.map((n) => n.jobId));
    } else if (notices.length) {
      await markNotified(notices.map((n) => n.jobId));
    }
    return jobs;
  },

  clear: async () => {
    set({ jobs: [], images: {}, pendingImages: {} });
    await AsyncStorage.removeItem(KEY).catch(() => {});
  },
}));
