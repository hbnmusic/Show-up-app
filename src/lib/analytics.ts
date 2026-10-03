/**
 * Anonymous usage analytics, stored in your own Supabase project (table ops.events, readable only by you).
 *  - A random install id made on the phone; it is not tied to an account, email, advertising id or device id.
 *  - Event names and values are listed in analyticsCore.ts. No personal data, no location, no show or band names.
 *  - On by default; Settings has a switch. Turning it off clears the queue and deletes this install's events on the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { enqueue, MAX_BATCH, setSink, track, uuid, type AnalyticsEvent, type EventName, type Props } from './analyticsCore';
import { communityEnabled } from './communityConfig';

const KEY = 'pull-up-analytics-v1';
const SESSION_GAP_MS = 30 * 60_000;
const FLUSH_EVERY_MS = 30_000;

type Saved = { installId: string; enabled: boolean; pendingForget?: string };

let saved: Saved | null = null;
let loading: Promise<Saved> | null = null;
let queue: AnalyticsEvent[] = [];
let sessionId = uuid();
let lastActive = Date.now();
let flushing = false;
let started = false;

async function load(): Promise<Saved> {
  if (saved) return saved;
  loading ??= (async () => {
    let s: Saved | null = null;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
      if (p && typeof p.installId === 'string' && typeof p.enabled === 'boolean') s = { installId: p.installId, enabled: p.enabled, pendingForget: p.pendingForget };
    } catch {
      // Unreadable: start fresh.
    }
    saved = s ?? { installId: uuid(), enabled: true };
    if (!s) await persist();
    return saved;
  })();
  return loading;
}

async function persist() {
  try {
    if (saved) await AsyncStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Not saving is harmless: a new id is made next launch.
  }
}

const meta = () => ({
  app_version: Constants.expoConfig?.version ?? 'unknown',
  os_version: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 20),
});

/** Device details attached to feedback (and nothing else). */
export function deviceInfo() {
  const model = (Platform.constants as { Model?: string } | undefined)?.Model;
  return { ...meta(), device_model: typeof model === 'string' ? model.slice(0, 60) : 'unknown' };
}

export async function getInstallId(): Promise<string> {
  return (await load()).installId;
}

export async function analyticsEnabled(): Promise<boolean> {
  return (await load()).enabled;
}

async function rpc(name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase');
    if (!supabase) return false;
    const { error } = await supabase.rpc(name, args);
    return !error;
  } catch {
    return false;
  }
}

/** Send what is queued. Safe to call any time; failures keep the events for the next try. */
export async function flush(): Promise<void> {
  if (flushing || !communityEnabled) return;
  const s = await load();
  if (s.pendingForget && (await rpc('forget_install', { install: s.pendingForget }))) {
    s.pendingForget = undefined;
    await persist();
  }
  if (!s.enabled || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length) {
      const batch = queue.slice(0, MAX_BATCH);
      const ok = await rpc('log_events', { batch: { install_id: s.installId, session_id: sessionId, ...meta(), events: batch } });
      if (!ok) break;
      queue = queue.slice(batch.length);
    }
  } finally {
    flushing = false;
  }
}

function record(name: EventName, props: Props) {
  if (!communityEnabled) return;
  void load().then((s) => {
    if (!s.enabled) return;
    queue = enqueue(queue, { name, props, at: new Date().toISOString() });
    if (queue.length >= 20) void flush();
  });
}

/** Turn analytics on or off. Off clears the queue and deletes this install's events on the server. */
export async function setAnalyticsEnabled(on: boolean): Promise<void> {
  const s = await load();
  if (s.enabled === on) return;
  s.enabled = on;
  if (!on) {
    queue = [];
    s.pendingForget = s.installId;
    s.installId = uuid(); // a later opt-in starts as a new, unrelated install
  }
  await persist();
  if (!on) await flush();
}

/** Start recording: call once at launch. */
export function initAnalytics() {
  if (started) return;
  started = true;
  setSink(record);
  track('app_open');
  track('session_start');
  setInterval(() => void flush(), FLUSH_EVERY_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      if (Date.now() - lastActive > SESSION_GAP_MS) {
        sessionId = uuid();
        track('session_start');
      }
      track('app_open');
    } else {
      lastActive = Date.now();
      void flush();
    }
  });
}
