/** Build-time settings for the community features. Kept free of imports so tests and the listings store can read it cheaply. */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const communityEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
