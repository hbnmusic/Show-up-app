/**
 * The connection to the community database (Supabase). The project address and
 * the public "anon" key are baked in at build time from EXPO_PUBLIC_SUPABASE_URL
 * and EXPO_PUBLIC_SUPABASE_ANON_KEY. The anon key is meant to ship inside apps;
 * what it can do is limited by the row-level rules in supabase/schema.sql.
 * Without them the community features are hidden and everything else works.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { communityEnabled, SUPABASE_ANON_KEY, SUPABASE_URL } from './communityConfig';

export { communityEnabled };

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;
