import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
})();

const admin = createClient(SUPABASE_URL, serviceRole);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function currentUser(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user || null;
}

type Connection = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  spotify_user_id: string | null;
  display_name: string | null;
};

async function clearSpotify(userId: string) {
  await admin.from("activity_now").delete().eq("owner_id", userId).eq("kind", "spotify");
}

async function refreshAccessToken(connection: Connection): Promise<Connection> {
  if (new Date(connection.expires_at).getTime() > Date.now() + 60_000) return connection;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error("Spotify is not configured on Wavo yet.");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) {
    throw new Error(`Spotify refresh failed (${response.status}).`);
  }

  const next: Connection = {
    ...connection,
    access_token: token.access_token,
    refresh_token: token.refresh_token || connection.refresh_token,
    scope: token.scope || connection.scope,
    expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000).toISOString(),
  };

  const { error } = await admin.from("spotify_connections").update({
    access_token: next.access_token,
    refresh_token: next.refresh_token,
    scope: next.scope,
    expires_at: next.expires_at,
    updated_at: new Date().toISOString(),
  }).eq("user_id", connection.user_id);
  if (error) throw error;
  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !serviceRole) return json({ error: "Wavo server configuration is incomplete." }, 503);

  const user = await currentUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: sharing } = await admin
    .from("activity_sharing")
    .select("share_spotify,invisible")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!sharing?.share_spotify || sharing?.invisible) {
    await clearSpotify(user.id);
    return json({ connected: null, shared: false, playing: false });
  }

  const { data: rawConnection, error: connectionError } = await admin
    .from("spotify_connections")
    .select("user_id,access_token,refresh_token,expires_at,scope,spotify_user_id,display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connectionError) return json({ error: connectionError.message }, 500);
  if (!rawConnection) {
    await clearSpotify(user.id);
    return json({ connected: false, shared: true, playing: false });
  }

  try {
    const connection = await refreshAccessToken(rawConnection as Connection);
    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { authorization: `Bearer ${connection.access_token}` },
    });

    if (response.status === 204) {
      await clearSpotify(user.id);
      return json({ connected: true, shared: true, playing: false });
    }

    if (response.status === 401) {
      // Force a refresh on the next poll instead of leaving stale activity up.
      await admin.from("spotify_connections").update({ expires_at: new Date(0).toISOString() }).eq("user_id", user.id);
      await clearSpotify(user.id);
      return json({ connected: true, shared: true, playing: false, retry: true });
    }

    if (!response.ok) {
      await clearSpotify(user.id);
      return json({ error: `Spotify currently-playing failed (${response.status}).` }, 502);
    }

    const now = await response.json();
    const item = now?.item;
    if (!now?.is_playing || !item?.name) {
      await clearSpotify(user.id);
      return json({ connected: true, shared: true, playing: false });
    }

    const artists = Array.isArray(item.artists)
      ? item.artists.map((artist: { name?: string }) => artist?.name).filter(Boolean).join(", ")
      : "";
    const image = item.album?.images?.[0]?.url || null;
    const url = item.external_urls?.spotify || null;
    const payload = {
      track: String(item.name).slice(0, 180),
      artist: String(artists).slice(0, 220),
      album: item.album?.name ? String(item.album.name).slice(0, 180) : null,
      image,
      url,
      progress_ms: Number(now.progress_ms || 0),
      duration_ms: Number(item.duration_ms || 0),
      is_playing: true,
    };

    const timestamp = new Date().toISOString();
    const { error: activityError } = await admin.from("activity_now").upsert({
      owner_id: user.id,
      kind: "spotify",
      payload,
      updated_at: timestamp,
      expires_at: new Date(Date.now() + 90_000).toISOString(),
    }, { onConflict: "owner_id,kind" });
    if (activityError) throw activityError;

    return json({ connected: true, shared: true, playing: true, activity: payload });
  } catch (err) {
    console.error("[spotify-now]", err);
    await clearSpotify(user.id);
    return json({ error: err instanceof Error ? err.message : "Could not sync Spotify." }, 500);
  }
});
