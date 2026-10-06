import { createClient } from "@supabase/supabase-js";

function send(res, status, body) {
  res.status(status);
  if (typeof body === "string") return res.end(body);
  return res.json(body);
}

let googleTokenCache = { token: null, expiresAt: 0, pending: null };
const clipCache = new Map();
const CLIP_CACHE_MS = 2 * 60 * 1000;

async function googleAccessToken() {
  const now = Date.now();
  if (googleTokenCache.token && googleTokenCache.expiresAt > now + 60_000) {
    return googleTokenCache.token;
  }
  if (googleTokenCache.pending) return googleTokenCache.pending;

  googleTokenCache.pending = (async () => {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) return null;

    const expiresInMs = Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    googleTokenCache.token = payload.access_token;
    googleTokenCache.expiresAt = Date.now() + expiresInMs;
    return googleTokenCache.token;
  })();

  try {
    return await googleTokenCache.pending;
  } finally {
    googleTokenCache.pending = null;
  }
}

async function loadPublishedClip(admin, clipId) {
  const cached = clipCache.get(clipId);
  if (cached && cached.expiresAt > Date.now()) return cached.clip;

  const { data: clip, error } = await admin.from("waves_curated_clips")
    .select("video_provider,video_asset_id,source_drive_id,status,moderation_state")
    .eq("id", clipId)
    .eq("status", "published")
    .maybeSingle();

  if (error) throw error;
  if (clip) clipCache.set(clipId, { clip, expiresAt: Date.now() + CLIP_CACHE_MS });
  return clip || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });

  const clipId = String(req.query?.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) return send(res, 400, { error: "Invalid clip" });

  const auth = String(req.headers.authorization || "");
  const userToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : String(req.query?.token || "").trim();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return send(res, 500, { error: "Server auth is not configured" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Published, moderation-cleared curated Waves are intentionally public.
  // Old clients may still send a token; validate it when supplied, while new
  // clients avoid this extra round trip entirely.
  if (userToken) {
    const { data: userData } = await admin.auth.getUser(userToken);
    if (!userData?.user) return send(res, 401, { error: "Session expired" });
  }

  let clip;
  try {
    clip = await loadPublishedClip(admin, clipId);
  } catch (error) {
    console.warn("[waves-video] clip lookup failed", { code: error?.code || null });
    return send(res, 502, { error: "Could not load video metadata" });
  }

  if (!clip || clip.moderation_state !== "clear" || clip.video_provider !== "google_drive" || !clip.video_asset_id) {
    console.warn("[waves-video] clip unavailable", {
      found: Boolean(clip),
      moderation: clip?.moderation_state || null,
      provider: clip?.video_provider || null,
      hasAsset: Boolean(clip?.video_asset_id),
    });
    return send(res, 404, { error: "Video not found" });
  }

  const googleToken = await googleAccessToken();
  if (!googleToken) return send(res, 503, { error: "Video storage is unavailable" });

  // iOS AVPlayer depends heavily on byte ranges. Two-megabyte chunks cut the
  // request count roughly in half while staying comfortably below normal
  // serverless response-size ceilings.
  const CHUNK_BYTES = 2 * 1024 * 1024;
  const requestedRange = String(req.headers.range || "").trim();
  let range = null;

  if (req.method === "GET") {
    if (!requestedRange) {
      range = `bytes=0-${CHUNK_BYTES - 1}`;
    } else {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(requestedRange);
      const suffix = /^bytes=-(\d+)$/i.exec(requestedRange);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : start + CHUNK_BYTES - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
          return send(res, 416, { error: "Invalid video range" });
        }
        range = `bytes=${start}-${Math.min(end, start + CHUNK_BYTES - 1)}`;
      } else if (suffix) {
        const count = Number(suffix[1]);
        if (!Number.isSafeInteger(count) || count < 1) return send(res, 416, { error: "Invalid video range" });
        range = `bytes=-${Math.min(count, CHUNK_BYTES)}`;
      } else {
        return send(res, 416, { error: "Unsupported video range" });
      }
    }
  }

  const headers = { Authorization: `Bearer ${googleToken}` };
  if (range) headers.Range = range;

  async function fetchDriveMedia(assetId) {
    return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(assetId)}?alt=media&supportsAllDrives=true`, {
      method: req.method,
      headers,
    });
  }

  let drive = await fetchDriveMedia(clip.video_asset_id);
  if (drive.status === 404 && clip.source_drive_id && clip.source_drive_id !== clip.video_asset_id) {
    await drive.body?.cancel().catch(() => {});
    console.warn("[waves-video] copied asset unavailable; trying source asset");
    drive = await fetchDriveMedia(clip.source_drive_id);
  }

  if (drive.status === 416) {
    const contentRange = drive.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    return send(res, 416, { error: "Video range unavailable" });
  }
  if (!drive.ok) {
    console.warn("[waves-video] Google Drive rejected media request", { status: drive.status });
    return send(res, drive.status === 404 ? 404 : 502, { error: "Could not load video" });
  }
  if (req.method === "GET" && drive.status !== 206) {
    await drive.body?.cancel().catch(() => {});
    return send(res, 502, { error: "Video storage did not honour byte-range requests" });
  }

  res.status(drive.status);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = drive.headers.get(name);
    if (value) res.setHeader(name, value);
  }

  // These clips are published public content. Allow short CDN/browser reuse of
  // byte ranges so replaying or swiping back does not immediately hit Drive.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
  res.setHeader("Vary", "Range");
  res.setHeader("Referrer-Policy", "no-referrer");
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
