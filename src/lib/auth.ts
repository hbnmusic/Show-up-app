/**
 * Sign-in for the community features: an email address and a one-time code.
 * There is no password. Browsing and saving shows never needs an account.
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { supabase } from './supabase';

type AuthState = {
  ready: boolean;
  userId: string | null;
  email: string | null;
  /** Email a 6-digit code. Returns an error message, or null when sent. */
  sendCode: (email: string) => Promise<string | null>;
  /** Check the code. Returns an error message, or null when signed in. */
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  init: () => void;
};

let started = false;

const friendly = (m: string) =>
  /rate limit|too many|seconds/i.test(m)
    ? 'Too many emails were requested. Wait a minute and try again.'
    : /expired|invalid/i.test(m)
      ? 'That code is wrong or has expired. Request a new one.'
      : m;

export const useAuth = create<AuthState>()((set) => ({
  ready: false,
  userId: null,
  email: null,

  init: () => {
    if (started) return;
    started = true;
    if (!supabase) {
      set({ ready: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      set({ ready: true, userId: data.session?.user.id ?? null, email: data.session?.user.email ?? null });
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ userId: session?.user.id ?? null, email: session?.user.email ?? null });
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
}));
