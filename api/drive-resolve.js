import { createClient } from "@supabase/supabase-js";
import { pickDriveUploadCandidate } from "./lib/driveResolveCandidate.js";

function json(res, status, body) {
  return res.status(status).json(body);
}

function cleanName(value) {
  return String(value || "attachment")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 200) || "attachment";
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (!response.ok || !payload?.access_token) return null;
  return payload.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(res, 500, { error: "Server auth is not configured." });

  const authHeader = String(req.headers.authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) return json(res, 401, { error: "Sign in to upload files." });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json(res, 401, { error: "Your session expired. Sign in again." });

  const fileName = cleanName(req.body?.fileName);
  const size = Number(req.body?.size);
  if (!Number.isFinite(size) || size <= 0) return json(res, 400, { error: "Invalid file size." });

  const googleToken = await googleAccessToken();
  if (!googleToken) return json(res, 503, { error: "Wavo large-file storage is still being connected." });

  // Do not put the filename in Drive's q expression. iOS/Drive can normalise
  // filenames during a resumable upload, and Drive listing can take a moment
  // to become consistent. Search only Wavo-owned chat files, then verify the
  // exact name + byte size locally. Retry briefly so a successful upload is
  // never reported as failed just because the list endpoint lagged behind.
  const query = [
    "trashed = false",
    `appProperties has { key='wavoUserId' and value='${escapeDriveQuery(user.id)}' }`,
    "appProperties has { key='wavoSource' and value='chat' }",
  ].join(" and ");
  const fields = encodeURIComponent("files(id,name,size,createdTime,appProperties)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=100&orderBy=createdTime%20desc&fields=${fields}`;
  const cutoff = Date.now() - 30 * 60 * 1000;

  let sawAmbiguity = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await wait(750);

    const response = await fetch(url, { headers: { Authorization: `Bearer ${googleToken}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[drive-resolve] search failed", response.status, payload?.error?.message);
      return json(res, 502, { error: "Wavo couldn't confirm that Drive upload." });
    }

    const candidate = pickDriveUploadCandidate(payload.files, {
      userId: user.id, fileName, size, cutoff,
    });
    if (candidate.fileId) return json(res, 200, { fileId: candidate.fileId });
    sawAmbiguity ||= candidate.ambiguous;
  }

  if (sawAmbiguity) {
    return json(res, 409, { error: "Several recent uploads match. Wavo can't safely identify this attachment; please retry the upload." });
  }
  return json(res, 404, { error: "The file reached Google Drive, but Wavo couldn't identify it after retrying." });
}
