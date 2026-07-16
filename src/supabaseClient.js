import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Heartbeat: records "this user was active today" for the founder dashboard.
// Fires when the app opens with a signed-in session (and after sign-in).
// The database upsert is idempotent — one row per user per day, so calling
// it repeatedly costs nothing.
let lastPing = 0;
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session?.user) return;
  const now = Date.now();
  if (now - lastPing < 60_000) return; // throttle: at most once per minute
  lastPing = now;
  supabase.rpc("ping_activity").then(
    () => {},
    () => {}
  );
});
