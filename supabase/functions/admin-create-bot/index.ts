import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://www.wavo.lol",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);

  const caller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || !authData?.user) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", authData.user.id).maybeSingle();
  if (!profile?.is_admin) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const username = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.displayName || "").trim();
  const description = String(body.description || "").trim().slice(0, 160);
  const accountType = String(body.accountType || "official_bot");
  if (!/^[a-z0-9_]{3,24}$/.test(username) || !displayName || displayName.length > 50) {
    return json({ ok: false, error: "invalid_username_or_display_name" }, 400);
  }
  if (!["official_bot", "integration_bot"].includes(accountType)) {
    return json({ ok: false, error: "invalid_bot_type" }, 400);
  }

  const randomPassword = `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `${username}@bots.wavo.lol`,
    password: randomPassword,
    email_confirm: true,
    app_metadata: { account_type: accountType, bot_owner_id: authData.user.id },
    user_metadata: {
      username,
      first_name: displayName,
      bot_description: description,
      signup_version: "bot",
    },
  });
  if (createError || !created?.user) {
    return json({ ok: false, error: createError?.message || "bot_creation_failed" }, 400);
  }
  const { error: updateError } = await admin.from("profiles")
    .update({ account_type: accountType })
    .eq("id", created.user.id);
  if (updateError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ ok: false, error: "bot_profile_setup_failed" }, 500);
  }

  await admin.from("admin_actions").insert({
    actor_id: authData.user.id,
    action: "create_bot_account",
    target_user_id: created.user.id,
    detail: `${accountType}: @${username}`,
  });

  return json({ ok: true, username, accountType });
});
