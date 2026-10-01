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

function normaliseEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normaliseUsername(value: unknown) {
  const username = String(value || "").trim().toLowerCase();
  if (!username || username.length > 64) return "";
  return username;
}

function passwordOkay(value: unknown) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128;
}

function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  const visible = local.length <= 2 ? local[0] || "*" : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, Math.min(8, local.length - visible.length)))}@${domain}`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) throw new Error("email_not_configured");
  const from = Deno.env.get("WAVO_EMAIL_FROM") || "Wavo <noreply@wavo.lol>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`email_delivery_failed:${response.status}:${text.slice(0, 240)}`);
  }
}

async function authenticatedUser(admin: any, req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data?.user || null;
}

async function verifyPassword(supabaseUrl: string, anonKey: string, email: string, password: string) {
  if (!anonKey || !email || !password) return false;
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await authClient.auth.signInWithPassword({ email, password });
  return !error;
}

const GENERIC_RESET_MESSAGE = "If that Wavo account has a verified recovery email, a reset link has been sent.";
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = getSecretKey();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body?.action || "");

  if (action === "health") {
    return json({ ok: true, email_delivery_configured: Boolean(Deno.env.get("RESEND_API_KEY")) });
  }

  if (action === "status") {
    const user = await authenticatedUser(admin, req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data } = await admin
      .from("account_recovery")
      .select("recovery_email,recovery_email_verified_at,pending_recovery_email,pending_email_expires_at")
      .eq("user_id", user.id)
      .maybeSingle();
    return json({
      ok: true,
      recovery_email: data?.recovery_email || null,
      recovery_email_masked: data?.recovery_email ? maskEmail(data.recovery_email) : null,
      verified: Boolean(data?.recovery_email && data?.recovery_email_verified_at),
      pending_recovery_email: data?.pending_recovery_email || null,
      pending_recovery_email_masked: data?.pending_recovery_email ? maskEmail(data.pending_recovery_email) : null,
    });
  }

  if (action === "request-reset") {
    const username = normaliseUsername(body?.username);
    if (!username) return json({ ok: true, message: GENERIC_RESET_MESSAGE });

    const now = new Date();
    const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
    const identifierHash = await sha256(`username:${username}`);
    const ipHash = await sha256(`ip:${clientIp(req)}`);

    const [{ count: idCount }, { count: ipCount }] = await Promise.all([
      admin.from("password_reset_attempts").select("id", { count: "exact", head: true }).eq("identifier_hash", identifierHash).gte("created_at", since),
      admin.from("password_reset_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since),
    ]);

    if ((idCount || 0) >= 3 || (ipCount || 0) >= 20) {
      return json({ ok: true, message: GENERIC_RESET_MESSAGE });
    }

    await admin.from("password_reset_attempts").insert({ identifier_hash: identifierHash, ip_hash: ipHash });
    admin.from("password_reset_attempts").delete().lt("created_at", new Date(Date.now() - 7 * 86400000).toISOString()).then(() => {}).catch(() => {});

    const { data: profile } = await admin
      .from("profiles")
      .select("id,username")
      .ilike("username", username)
      .limit(1)
      .maybeSingle();

    if (!profile?.id) return json({ ok: true, message: GENERIC_RESET_MESSAGE });

    const { data: recovery } = await admin
      .from("account_recovery")
      .select("recovery_email,recovery_email_verified_at")
      .eq("user_id", profile.id)
      .maybeSingle();

    if (!recovery?.recovery_email || !recovery?.recovery_email_verified_at) {
      return json({ ok: true, message: GENERIC_RESET_MESSAGE });
    }

    const rawToken = randomToken();
    const tokenHash = await sha256(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

    await admin.from("password_reset_tokens").update({ used_at: now.toISOString() }).eq("user_id", profile.id).is("used_at", null);
    const { data: inserted, error: insertError } = await admin
      .from("password_reset_tokens")
      .insert({ user_id: profile.id, token_hash: tokenHash, expires_at: expiresAt })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("account recovery token insert", insertError);
      return json({ ok: true, message: GENERIC_RESET_MESSAGE });
    }

    const baseUrl = (Deno.env.get("WAVO_PUBLIC_URL") || "https://wavo.lol").replace(/\/$/, "");
    const link = `${baseUrl}/?reset_token=${encodeURIComponent(rawToken)}`;

    try {
      await sendEmail(
        recovery.recovery_email,
        "Reset your Wavo password",
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto;padding:28px;color:#142033"><h1 style="font-size:24px">Reset your Wavo password</h1><p>A password reset was requested for your Wavo account.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#675cff;color:white;text-decoration:none;font-weight:700">Reset password</a></p><p style="color:#667085;font-size:13px">This link expires in 1 hour. If you didn't request it, you can ignore this email.</p></div>`,
      );
    } catch (error) {
      console.error("account recovery email delivery", error);
      await admin.from("password_reset_tokens").delete().eq("id", inserted.id);
    }

    return json({ ok: true, message: GENERIC_RESET_MESSAGE });
  }

  if (action === "reset-password") {
    const rawToken = String(body?.token || "").trim();
    const newPassword = String(body?.newPassword || "");
    if (!rawToken || !passwordOkay(newPassword)) {
      return json({ error: "invalid_request", message: "Use a password with at least 8 characters." }, 400);
    }

    const tokenHash = await sha256(rawToken);
    const { data: resetRow } = await admin
      .from("password_reset_tokens")
      .select("id,user_id,expires_at,used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at).getTime() <= Date.now()) {
      return json({ error: "invalid_or_expired", message: "That reset link is invalid or has expired." }, 400);
    }

    const { error: passwordError } = await admin.auth.admin.updateUserById(resetRow.user_id, { password: newPassword });
    if (passwordError) {
      console.error("account recovery password update", passwordError);
      return json({ error: "password_update_failed", message: "Wavo couldn't update the password right now." }, 500);
    }

    const usedAt = new Date().toISOString();
    await admin.from("password_reset_tokens").update({ used_at: usedAt }).eq("user_id", resetRow.user_id).is("used_at", null);
    return json({ ok: true });
  }

  if (action === "begin-email-verification") {
    const user = await authenticatedUser(admin, req);
    if (!user) return json({ error: "unauthorized" }, 401);

    const recoveryEmail = normaliseEmail(body?.email);
    const currentPassword = String(body?.currentPassword || "");
    if (!recoveryEmail) return json({ error: "invalid_email", message: "Enter a valid email address." }, 400);
    if (!currentPassword) return json({ error: "password_required", message: "Enter your current Wavo password." }, 400);

    const currentAuthEmail = user.email || "";
    const passwordValid = await verifyPassword(supabaseUrl, anonKey, currentAuthEmail, currentPassword);
    if (!passwordValid) return json({ error: "wrong_password", message: "That current password is not correct." }, 401);

    const rawToken = randomToken();
    const tokenHash = await sha256(rawToken);
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();

    const { error: pendingError } = await admin
      .from("account_recovery")
      .upsert({
        user_id: user.id,
        pending_recovery_email: recoveryEmail,
        pending_email_token_hash: tokenHash,
        pending_email_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (pendingError) {
      console.error("account recovery pending email", pendingError);
      return json({ error: "save_failed", message: "Wavo couldn't save that recovery email right now." }, 500);
    }

    const baseUrl = (Deno.env.get("WAVO_PUBLIC_URL") || "https://wavo.lol").replace(/\/$/, "");
    const link = `${baseUrl}/?verify_recovery_token=${encodeURIComponent(rawToken)}`;

    try {
      await sendEmail(
        recoveryEmail,
        "Verify your Wavo recovery email",
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto;padding:28px;color:#142033"><h1 style="font-size:24px">Verify your recovery email</h1><p>Confirm this email so Wavo can use it if you ever forget your password.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#675cff;color:white;text-decoration:none;font-weight:700">Verify recovery email</a></p><p style="color:#667085;font-size:13px">This link expires in 1 hour.</p></div>`,
      );
    } catch (error) {
      console.error("recovery email verification delivery", error);
      await admin.from("account_recovery").update({
        pending_recovery_email: null,
        pending_email_token_hash: null,
        pending_email_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
      return json({ error: "email_unavailable", message: "Wavo couldn't send the verification email right now." }, 503);
    }

    return json({ ok: true, masked_email: maskEmail(recoveryEmail) });
  }

  if (action === "verify-recovery-email") {
    const rawToken = String(body?.token || "").trim();
    if (!rawToken) return json({ error: "invalid_token", message: "That verification link is invalid." }, 400);
    const tokenHash = await sha256(rawToken);
    const { data: recovery } = await admin
      .from("account_recovery")
      .select("user_id,pending_recovery_email,pending_email_expires_at")
      .eq("pending_email_token_hash", tokenHash)
      .maybeSingle();

    if (!recovery?.pending_recovery_email || !recovery.pending_email_expires_at || new Date(recovery.pending_email_expires_at).getTime() <= Date.now()) {
      return json({ error: "invalid_or_expired", message: "That verification link is invalid or has expired." }, 400);
    }

    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("account_recovery")
      .update({
        recovery_email: recovery.pending_recovery_email,
        recovery_email_verified_at: verifiedAt,
        pending_recovery_email: null,
        pending_email_token_hash: null,
        pending_email_expires_at: null,
        updated_at: verifiedAt,
      })
      .eq("user_id", recovery.user_id);

    if (updateError) return json({ error: "verify_failed", message: "Wavo couldn't verify that email right now." }, 500);
    return json({ ok: true });
  }

  if (action === "change-password") {
    const user = await authenticatedUser(admin, req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    if (!passwordOkay(newPassword)) return json({ error: "weak_password", message: "Use a password with at least 8 characters." }, 400);
    const passwordValid = await verifyPassword(supabaseUrl, anonKey, user.email || "", currentPassword);
    if (!passwordValid) return json({ error: "wrong_password", message: "That current password is not correct." }, 401);
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (error) return json({ error: "password_update_failed", message: "Wavo couldn't update your password right now." }, 500);
    return json({ ok: true });
  }

  if (action === "remove-recovery-email") {
    const user = await authenticatedUser(admin, req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const currentPassword = String(body?.currentPassword || "");
    const passwordValid = await verifyPassword(supabaseUrl, anonKey, user.email || "", currentPassword);
    if (!passwordValid) return json({ error: "wrong_password", message: "That current password is not correct." }, 401);
    await admin.from("account_recovery").upsert({
      user_id: user.id,
      recovery_email: null,
      recovery_email_verified_at: null,
      pending_recovery_email: null,
      pending_email_token_hash: null,
      pending_email_expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
