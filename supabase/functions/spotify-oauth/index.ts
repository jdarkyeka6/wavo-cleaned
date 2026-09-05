import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
})();

const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("SPOTIFY_REDIRECT_URI") || `${SUPABASE_URL}/functions/v1/spotify-oauth`;
const SUCCESS_URL = Deno.env.get("SPOTIFY_SUCCESS_URL") || "https://wavo.lol/?spotify=connected";
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"].join(" ");

const admin = createClient(SUPABASE_URL, serviceRole);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function configured() {
  return Boolean(SUPABASE_URL && ANON_KEY && serviceRole && SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET);
}

async function currentUser(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user || null;
}

async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Spotify token exchange failed: ${response.status} ${JSON.stringify(data).slice(0, 180)}`);
  return data as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
  };
}

async function spotifyProfile(accessToken: string) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return await response.json() as { id?: string; display_name?: string };
}

async function handleCallback(url: URL) {
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  if (error) return Response.redirect(`${SUCCESS_URL}${SUCCESS_URL.includes("?") ? "&" : "?"}spotify=denied`, 302);
  if (!code || !state) return json({ error: "Missing Spotify callback parameters." }, 400);
  if (!configured()) return json({ error: "Spotify is not configured on Wavo yet." }, 503);

  const { data: stateRow } = await admin
    .from("spotify_oauth_states")
    .select("state,user_id,expires_at")
    .eq("state", state)
    .maybeSingle();

  if (!stateRow || new Date(stateRow.expires_at).getTime() <= Date.now()) {
    if (stateRow) await admin.from("spotify_oauth_states").delete().eq("state", state);
    return json({ error: "Spotify connection expired. Start again from Wavo." }, 400);
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Spotify did not return a refresh token.");
    const profile = await spotifyProfile(tokens.access_token);
    const expiresAt = new Date(Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000).toISOString();

    const { error: saveError } = await admin.from("spotify_connections").upsert({
      user_id: stateRow.user_id,
      spotify_user_id: profile?.id || null,
      display_name: profile?.display_name || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || SCOPES,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (saveError) throw saveError;

    await admin.from("spotify_oauth_states").delete().eq("state", state);
    return Response.redirect(SUCCESS_URL, 302);
  } catch (err) {
    console.error("[spotify-oauth] callback", err);
    await admin.from("spotify_oauth_states").delete().eq("state", state);
    return json({ error: err instanceof Error ? err.message : "Spotify connection failed." }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
    return handleCallback(url);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!configured()) return json({ error: "Spotify is not configured on Wavo yet." }, 503);

  const user = await currentUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "status");

  if (action === "status") {
    const { data } = await admin
      .from("spotify_connections")
      .select("spotify_user_id,display_name,expires_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    return json({ connected: Boolean(data), connection: data || null });
  }

  if (action === "disconnect") {
    await admin.from("spotify_connections").delete().eq("user_id", user.id);
    await admin.from("activity_now").delete().eq("owner_id", user.id).eq("kind", "spotify");
    return json({ connected: false });
  }

  if (action !== "start") return json({ error: "Unknown action" }, 400);

  await admin.from("spotify_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const state = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const { error: stateError } = await admin.from("spotify_oauth_states").insert({
    state,
    user_id: user.id,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (stateError) return json({ error: "Could not start Spotify connection." }, 500);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("show_dialog", "false");

  return json({ url: authUrl.toString(), redirect_uri: REDIRECT_URI });
});
