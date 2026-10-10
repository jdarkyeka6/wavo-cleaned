import { createClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";

function respond(res, status, error) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(status).json({ error });
}

async function googleAccessToken() {
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
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.access_token || null;
}

function validFileId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,200}$/.test(value);
}

async function canReadSharedFile(admin, userId, file) {
  // Uploader may always retrieve their own file, including during upload finalization.
  if (file.user_id === userId) return true;

  const link = `/api/private-drive-file?id=${encodeURIComponent(file.drive_file_id)}`;

  // A sender cannot grant access to another account's file just by pasting its ID.
  // The original uploader must be the sender of a non-deleted message.
  const { data: dm, error: dmError } = await admin
    .from("messages")
    .select("id")
    .eq("content", link)
    .eq("sender_id", file.user_id)
    .eq("receiver_id", userId)
    .is("deleted_at", null)
    .limit(1);
  if (dmError) throw dmError;
  if (dm?.length) return true;

  const { data: shared, error: sharedError } = await admin
    .from("group_messages")
    .select("group_id")
    .eq("content", link)
    .eq("sender_id", file.user_id)
    .is("deleted_at", null)
    .limit(100);
  if (sharedError) throw sharedError;
  const groupIds = [...new Set((shared || []).map((row) => row.group_id).filter(Boolean))];
  if (!groupIds.length) return false;

  const { data: membership, error: memberError } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .in("group_id", groupIds)
    .limit(1);
  if (memberError) throw memberError;
  return Boolean(membership?.length);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return respond(res, 405, "Method not allowed");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");

  const fileId = req.query?.id;
  if (!validFileId(fileId)) return respond(res, 400, "Invalid file");
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return respond(res, 401, "Sign in to view this attachment");

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return respond(res, 503, "Attachment service unavailable");

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userError || !userId) return respond(res, 401, "Session expired");

    const { data: file, error: lookupError } = await admin
      .from("drive_files")
      .select("drive_file_id,user_id,file_name,mime_type,size_bytes")
      .eq("drive_file_id", fileId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!file || !(await canReadSharedFile(admin, userId, file))) {
      return respond(res, 404, "Attachment not found");
    }

    const range = String(req.headers.range || "");
    if (range && !/^bytes=\d*-\d*$/.test(range)) {
      return respond(res, 416, "Invalid range");
    }

    const googleToken = await googleAccessToken();
    if (!googleToken) return respond(res, 503, "Storage temporarily unavailable");
    const drive = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${googleToken}`, ...(range ? { Range: range } : {}) } },
    );
    if (!drive.ok || !drive.body) {
      return respond(res, drive.status === 404 ? 404 : 502, "Attachment unavailable");
    }

    const mime = String(file.mime_type || "application/octet-stream").replace(/[\r\n]/g, "");
    const filename = String(file.file_name || "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 180);
    res.status(drive.status === 206 ? 206 : 200);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const contentLength = drive.headers.get("content-length");
    const contentRange = drive.headers.get("content-range");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    res.setHeader("Accept-Ranges", "bytes");

    // Stream instead of buffering potentially large attachments in a serverless function.
    Readable.fromWeb(drive.body).on("error", (err) => {
      console.error("[private-drive-file] stream", err);
      res.destroy(err);
    }).pipe(res);
  } catch (error) {
    console.error("[private-drive-file] request failed", error?.message);
    if (!res.headersSent) return respond(res, 500, "Could not load attachment");
    res.destroy();
  }
}
