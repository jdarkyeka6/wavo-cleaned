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

function normaliseUsername(value: unknown) {
  const username = String(value || "").trim();
  if (!username || username.length > 64) return "";
  return username;
}

function passwordOkay(value: unknown) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128;
}

function escapeIlike(value: string) {
  return value.replace(/([\\%_])/g, "\\$1");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = getSecretKey();
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return json({ error: "unauthorized", message: "Sign in again and retry." }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const actor = authData?.user;
  if (authError || !actor?.id) {
    return json({ error: "unauthorized", message: "Your admin session has expired." }, 401);
  }

  const { data: actorProfile, error: actorProfileError } = await admin
    .from("profiles")
    .select("id,username,is_admin")
    .eq("id", actor.id)
    .maybeSingle();

  if (actorProfileError || !actorProfile?.is_admin) {
    return json({ error: "forbidden", message: "This account does not have Wavo Admin access." }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json", message: "Invalid request." }, 400);
  }

  const username = normaliseUsername(body?.username);
  const newPassword = String(body?.newPassword || "");
  if (!username) return json({ error: "invalid_username", message: "Enter a Wavo username." }, 400);
  if (!passwordOkay(newPassword)) {
    return json({ error: "weak_password", message: "Use a password with 8 to 128 characters." }, 400);
  }

  const { data: matches, error: lookupError } = await admin
    .from("profiles")
    .select("id,username,is_admin")
    .ilike("username", escapeIlike(username))
    .limit(2);

  if (lookupError) {
    console.error("admin password reset profile lookup", lookupError);
    return json({ error: "lookup_failed", message: "Wavo could not find that account right now." }, 500);
  }

  if (!matches?.length) {
    return json({ error: "not_found", message: "No Wavo account matches that username." }, 404);
  }
  if (matches.length > 1) {
    return json({ error: "ambiguous_username", message: "More than one account matched. Use the exact username." }, 409);
  }

  const target = matches[0];
  const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
    password: newPassword,
  });

  if (updateError) {
    console.error("admin password reset auth update", updateError);
    return json({ error: "password_update_failed", message: "Wavo could not update that password." }, 500);
  }

  const now = new Date().toISOString();
  await admin
    .from("password_reset_tokens")
    .update({ used_at: now })
    .eq("user_id", target.id)
    .is("used_at", null);

  const { error: auditError } = await admin.from("admin_actions").insert({
    actor_id: actor.id,
    action: "reset_password",
    target_user_id: target.id,
    detail: `Password reset for @${target.username} from Admin Dashboard`,
  });
  if (auditError) console.error("admin password reset audit", auditError);

  return json({ ok: true, username: target.username });
});
