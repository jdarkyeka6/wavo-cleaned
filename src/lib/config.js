// Where the Supabase connection details come from, and what to do when they
// aren't there.
//
// Vite inlines import.meta.env.VITE_* at build time. Vercel supplies these, so
// wavo.lol has always been fine — but the iOS workflow ran `npm run build`
// with no environment at all, so every TestFlight build shipped with both
// values undefined. createClient() then threw "supabaseUrl is required." while
// the module graph was still evaluating, nothing rendered, and the app was a
// black screen with no way to tell why.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** What's missing, for the message shown when the app can't start. */
export function missingConfigKeys() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  return missing;
}
