import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
});

function getSecretKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (typeof first === "string") return first;
    } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const RESERVED = new Set(["admin", "support", "wavo", "system", "staff"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = getSecretKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config" }, 500);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const username = String(body?.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return json({
      error: "invalid_username",
      message: "Use 3–24 lowercase letters, numbers or underscores.",
    }, 400);
  }
  if (RESERVED.has(username)) {
    return json({ error: "reserved_username", message: "That username is reserved." }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,username,username_changed_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return json({ error: "profile_not_found" }, 404);

  const currentUsername = String(profile.username || "").toLowerCase();
  if (currentUsername === username) return json({ ok: true, username: profile.username, unchanged: true });

  if (profile.username_changed_at) {
    const changedAt = new Date(profile.username_changed_at).getTime();
    const remaining = changedAt + COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      return json({
        error: "username_cooldown",
        message: "You can change your username once every 7 days.",
        retry_after_seconds: Math.ceil(remaining / 1000),
        available_at: new Date(changedAt + COOLDOWN_MS).toISOString(),
      }, 429);
    }
  }

  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .neq("id", user.id)
    .limit(1)
    .maybeSingle();

  if (taken) return json({ error: "username_taken", message: "That username is already taken." }, 409);

  const oldEmail = user.email || `${profile.username}@wavo.app`;
  const oldMetadata = user.user_metadata || {};
  const newEmail = `${username}@wavo.app`;

  const { error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, {
    email: newEmail,
    user_metadata: { ...oldMetadata, username },
  });

  if (authUpdateError) {
    const lower = String(authUpdateError.message || "").toLowerCase();
    if (lower.includes("already") || lower.includes("duplicate") || lower.includes("registered")) {
      return json({ error: "username_taken", message: "That username is already taken." }, 409);
    }
    console.error("change-username auth update", authUpdateError);
    return json({ error: "auth_update_failed", message: "Wavo couldn't change that username right now." }, 500);
  }

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update({ username, username_changed_at: new Date().toISOString(), last_active: new Date().toISOString() })
    .eq("id", user.id)
    .select("username")
    .single();

  if (updateError || !updated) {
    console.error("change-username profile update", updateError);
    const { error: rollbackError } = await admin.auth.admin.updateUserById(user.id, {
      email: oldEmail,
      user_metadata: oldMetadata,
    });
    if (rollbackError) console.error("change-username rollback", rollbackError);
    return json({ error: "profile_update_failed", message: "Wavo couldn't change that username right now." }, 500);
  }

  return json({ ok: true, username: updated.username });
});
