import { createClient } from "@supabase/supabase-js";

const client = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Supabase already creates a profiles row for new auth users via a database
// trigger. Older signup code also tries to INSERT that same profile row, which
// causes a duplicate primary-key error. Make profile inserts idempotent by
// turning them into an upsert on the profile id.
const originalFrom = client.from.bind(client);
client.from = (table) => {
  const query = originalFrom(table);

  if (table === "profiles") {
    query.insert = (values, options = {}) =>
      query.upsert(values, {
        ...options,
        onConflict: "id",
      });
  }

  return query;
};

export const supabase = client;

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
