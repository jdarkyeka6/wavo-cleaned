import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./lib/config";

// Placeholders when the build had no environment. createClient() throws on an
// empty url, and because this module is imported at the root of the graph that
// throw took the whole app down before React ever ran — a black screen with
// nothing to read. main.jsx checks isConfigured and shows an explanation
// instead; these values exist only so the import itself survives that far.
const client = createClient(
  SUPABASE_URL || "https://placeholder.invalid",
  SUPABASE_ANON_KEY || "placeholder"
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
// Skipped when the build had no config: the client points at a placeholder
// host, so this would only produce failing background requests.
if (isConfigured) {
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
}
