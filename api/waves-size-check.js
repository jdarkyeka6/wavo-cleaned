import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const SOURCE_ROOT = "1RsvMIRFTGmv5Q6xYM64Gz7tm4kYkneND";

async function googleToken() {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Drive credentials are not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error("Could not connect to Drive");
  return body.access_token;
}

async function googleJson(path, token) {
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Drive ${response.status}`);
  return body;
}

async function listFolder(folderId, token) {
  let pageToken = null;
  let bytes = 0;
  let videos = 0;
  let overLimit = 0;
  let missingSize = 0;
  let shortcuts = 0;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,mimeType,size,shortcutDetails(targetId,targetMimeType))",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson("files?" + params.toString(), token);
    for (const raw of page.files || []) {
      let item = raw;
      if (raw.mimeType === SHORTCUT_MIME && raw.shortcutDetails?.targetId) {
        shortcuts += 1;
        const targetMime = raw.shortcutDetails?.targetMimeType;
        if (!VIDEO_MIME.has(targetMime)) continue;
        item = await googleJson(`files/${encodeURIComponent(raw.shortcutDetails.targetId)}?fields=id,mimeType,size&supportsAllDrives=true`, token);
      }
      if (!VIDEO_MIME.has(item.mimeType)) continue;
      const size = Number(item.size || 0);
      if (!size) {
        missingSize += 1;
        continue;
      }
      if (size > MAX_VIDEO_BYTES) {
        overLimit += 1;
        continue;
      }
      videos += 1;
      bytes += size;
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  return { bytes, videos, overLimit, missingSize, shortcuts };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase admin is not configured");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: progress, error } = await admin
      .from("waves_bulk_import_progress")
      .select("folder_queue,files_imported,files_existing")
      .eq("source_root_id", SOURCE_ROOT)
      .maybeSingle();
    if (error) throw error;
    const folders = Array.isArray(progress?.folder_queue) ? progress.folder_queue : [];
    if (!folders.length) throw new Error("Bundle folder queue was not found");

    const token = await googleToken();
    let next = 0;
    const total = { bytes: 0, videos: 0, overLimit: 0, missingSize: 0, shortcuts: 0 };
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= folders.length) return;
        const result = await listFolder(folders[index].id, token);
        total.bytes += result.bytes;
        total.videos += result.videos;
        total.overLimit += result.overLimit;
        total.missingSize += result.missingSize;
        total.shortcuts += result.shortcuts;
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));

    return res.status(200).json({
      sourceRoot: SOURCE_ROOT,
      folders: folders.length,
      importedRows: Number(progress?.files_imported || 0),
      existingRows: Number(progress?.files_existing || 0),
      videosWithSize: total.videos,
      bytes: total.bytes,
      decimalGB: total.bytes / 1e9,
      binaryGiB: total.bytes / 1073741824,
      decimalTB: total.bytes / 1e12,
      over500MB: total.overLimit,
      missingSize: total.missingSize,
      shortcutsSeen: total.shortcuts,
    });
  } catch (error) {
    console.error("[waves-size-check]", error?.message || error);
    return res.status(500).json({ error: error?.message || "Size audit failed" });
  }
}
