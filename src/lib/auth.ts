/**
 * Sign-in for the community features: an email address and a one-time code.
 * There is no password. Browsing and saving shows never needs an account.
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { supabase } from './supabase';

type AuthState = {
  ready: boolean;
  /** The signed-in person (email code). Null for nobody and for anonymous flyer-sharing accounts. */
  userId: string | null;
  /** The anonymous account used to share flyers without signing in, if one exists. */
  anonId: string | null;
  email: string | null;
  /** Email a 6-digit code. Returns an error message, or null when sent. */
  sendCode: (email: string) => Promise<string | null>;
  /** Check the code. Returns an error message, or null when signed in. */
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** The account to submit a flyer with: the signed-in one, else a new anonymous one. Returns null (with a message) if that fails. */
  ensureAccount: () => Promise<{ id: string; anonymous: boolean } | { error: string }>;
  init: () => void;
};

let started = false;

const friendly = (m: string) =>
  /rate limit|too many|seconds/i.test(m)
    ? 'Too many emails were requested. Wait a minute and try again.'
    : /expired|invalid/i.test(m)
      ? 'That code is wrong or has expired. Request a new one.'
      : m;

type U = { id: string; email?: string; is_anonymous?: boolean } | null | undefined;
const fromUser = (u: U) => ({ userId: u && !u.is_anonymous ? u.id : null, anonId: u?.is_anonymous ? u.id : null, email: u && !u.is_anonymous ? (u.email ?? null) : null });

export const useAuth = create<AuthState>()((set) => ({
  ready: false,
  userId: null,
  anonId: null,
  email: null,

  init: () => {
    if (started) return;
    started = true;
    if (!supabase) {
      set({ ready: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      set({ ready: true, ...fromUser(data.session?.user) });
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set(fromUser(session?.user));
    });
    // Keep the session fresh only while the app is open.
    AppState.addEventListener('change', (s) => {
      if (s === 'active') supabase!.auth.startAutoRefresh();
      else supabase!.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();
  },

  sendCode: async (email) => {
    if (!supabase) return 'Community features are not set up in this build.';
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    return error ? friendly(error.message) : null;
  },

  verifyCode: async (email, code) => {
    if (!supabase) return 'Community features are not set up in this build.';
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    return error ? friendly(error.message) : null;
  },

  signOut: async () => {
    await supabase?.auth.signOut();
  },

  ensureAccount: async () => {
    if (!supabase) return { error: 'Sharing flyers is not set up in this build.' };
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    if (u) return { id: u.id, anonymous: u.is_anonymous === true };
    const { data: created, error } = await supabase.auth.signInAnonymously();
    if (error || !created.user) return { error: /anonymous/i.test(error?.message ?? '') ? 'Anonymous sharing is not switched on yet. Sign in with your email instead.' : 'Could not start. Check your connection and try again.' };
    return { id: created.user.id, anonymous: true };
  },
}));
