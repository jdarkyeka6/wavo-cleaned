import { createClient } from "@supabase/supabase-js";

function send(res, status, body) {
  res.status(status);
  if (typeof body === "string") return res.end(body);
  return res.json(body);
}

async function googleAccessToken() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const payload = await response.json().catch(() => ({}));
  return response.ok ? payload.access_token || null : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });

  const clipId = String(req.query?.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) return send(res, 400, { error: "Invalid clip" });

  const auth = String(req.headers.authorization || "");
  const userToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : String(req.query?.token || "").trim();
  if (!userToken) return send(res, 401, { error: "Sign in to watch Waves" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return send(res, 500, { error: "Server auth is not configured" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData } = await admin.auth.getUser(userToken);
  if (!userData?.user) return send(res, 401, { error: "Session expired" });

  const { data: clip, error } = await admin.from("waves_curated_clips")
    .select("video_provider,video_asset_id,status,moderation_state")
    .eq("id", clipId).eq("status", "published").maybeSingle();
  if (error || !clip || clip.moderation_state !== "clear" || clip.video_provider !== "google_drive" || !clip.video_asset_id) {
    return send(res, 404, { error: "Video not found" });
  }

  const googleToken = await googleAccessToken();
  if (!googleToken) return send(res, 503, { error: "Video storage is unavailable" });

  const headers = { Authorization: `Bearer ${googleToken}` };
  const range = String(req.headers.range || "");
  if (range) headers.Range = range;
  const drive = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(clip.video_asset_id)}?alt=media&supportsAllDrives=true`, {
    method: req.method,
    headers,
  });

  if (!drive.ok && drive.status !== 206) return send(res, drive.status === 404 ? 404 : 502, { error: "Could not load video" });

  res.status(drive.status);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = drive.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD" || !drive.body) return res.end();

  const reader = drive.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once("drain", resolve));
    }
  } finally {
    res.end();
  }
}
