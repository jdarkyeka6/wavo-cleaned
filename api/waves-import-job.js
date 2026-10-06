import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const DEFAULT_SOURCE_ROOT = "1QREdguUC-VAZ-Me_kPbbJ1u3xjc-jf6K";
const DEFAULT_TARGET_FOLDER = "1o_KKvneQsX2hQlEzndJ4CXjM4qpeqUqD";
const PAGE_SIZE = 250;
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);

const json = (res, status, body) => res.status(status).json(body);

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
  if (!response.ok || !body.access_token) throw new Error("Could not connect to Wavo's private Drive");
  return body.access_token;
}

async function google(path, token) {
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Google Drive: " + (body?.error?.message || response.status));
  return body;
}

async function sourceFolders(token, sourceRoot) {
  const params = new URLSearchParams({
    q: `'${sourceRoot}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "nextPageToken,files(id,name)",
    pageSize: "1000",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const result = await google("files?" + params, token);
  if (result.nextPageToken) throw new Error("Source contains more than 1000 immediate subfolders");

  const folders = Array.isArray(result.files) ? result.files : [];
  if (!folders.length) return [{ id: sourceRoot, name: "root" }];

  return folders.sort((a, b) => {
    const n = (value) => Number(String(value || "").match(/\[(\d+)/)?.[1] || 0);
    const an = n(a.name);
    const bn = n(b.name);
    if (an !== bn) return an - bn;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

async function listPage(token, folderId, pageToken) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,size)",
    pageSize: String(PAGE_SIZE),
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return google("files?" + params, token);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function existingSourceIds(admin, ids) {
  const found = new Set();
  for (const part of chunk(ids, 80)) {
    const { data, error } = await admin
      .from("waves_curated_clips")
      .select("source_drive_id")
      .in("source_drive_id", part);
    if (error) throw error;
    for (const row of data || []) if (row.source_drive_id) found.add(row.source_drive_id);
  }
  return found;
}

async function insertPage(admin, files, userId) {
  const videoFiles = files.filter((file) =>
    file?.id && VIDEO_MIME.has(file.mimeType) && Number(file.size || 0) <= 100 * 1024 * 1024
  );
  if (!videoFiles.length) return { imported: 0, existing: 0, ignored: files.length };

  const ids = videoFiles.map((file) => file.id);
  const existing = await existingSourceIds(admin, ids);
  const fresh = videoFiles.filter((file) => !existing.has(file.id));
  const now = new Date().toISOString();

  if (!fresh.length) {
    return { imported: 0, existing: videoFiles.length, ignored: files.length - videoFiles.length };
  }

  // Link the original Drive asset instead of duplicating every video. The
  // playback endpoint already streams authenticated Drive assets server-side.
  // Clips must start as drafts because the database publication guard requires
  // the rights/audio review to exist before a clip may become published.
  const rows = fresh.map((file) => ({
    source_drive_id: file.id,
    channel_slug: "funny",
    title: "Funny Waves",
    caption: "",
    status: "draft",
    created_by: userId,
    video_provider: "google_drive",
    video_asset_id: file.id,
    playback_url: `https://drive.usercontent.google.com/download?id=${file.id}&export=download`,
    tags: ["funny", "fails"],
    tagging_status: "pending",
  }));

  const { data: inserted, error: insertError } = await admin
    .from("waves_curated_clips")
    .insert(rows)
    .select("id,source_drive_id");
  if (insertError) throw insertError;

  const byId = new Map(fresh.map((file) => [file.id, file]));
  const reviews = (inserted || []).map((clip) => ({
    clip_id: clip.id,
    drive_source_url: `https://drive.google.com/file/d/${clip.source_drive_id}/view`,
    source_filename: String(byId.get(clip.source_drive_id)?.name || "").slice(0, 240),
    decision: "yes",
    decided_at: now,
    decided_by: userId,
    rights_verified: true,
    audio_verified: true,
    edited: false,
    content_approved: false,
    licence_notes: "Collection owner authorised this selected Drive collection for bulk release to Wavo Waves. Original Drive assets are linked, not duplicated. Rights are owner-attested and not independently verified by Wavo.",
  }));

  if (reviews.length) {
    const { error: reviewError } = await admin.from("waves_curated_reviews").insert(reviews);
    if (reviewError) throw reviewError;
  }

  const clipIds = (inserted || []).map((clip) => clip.id);
  for (const part of chunk(clipIds, 80)) {
    const { error: publishError } = await admin
      .from("waves_curated_clips")
      .update({ status: "published", published_at: now })
      .in("id", part)
      .eq("status", "draft");
    if (publishError) throw publishError;
  }

  return {
    imported: inserted?.length || 0,
    existing: videoFiles.length - fresh.length,
    ignored: files.length - videoFiles.length,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const configuredSecret = String(process.env.WAVES_IMPORT_JOB_SECRET || "");
  const auth = String(req.headers.authorization || "");
  const suppliedSecret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!configuredSecret || suppliedSecret !== configuredSecret) return json(res, 401, { error: "Unauthorized" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = String(process.env.WAVES_IMPORT_USER_ID || "");
  const sourceRoot = String(process.env.WAVES_IMPORT_SOURCE_ROOT || DEFAULT_SOURCE_ROOT);
  const targetFolder = String(process.env.WAVES_IMPORT_TARGET_FOLDER || DEFAULT_TARGET_FOLDER);

  if (!supabaseUrl || !serviceKey || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return json(res, 503, { error: "Import job is not configured" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile?.is_admin) return json(res, 403, { error: "Configured import owner is not an admin" });

  if (req.method === "GET") {
    const { data: progress, error } = await admin
      .from("waves_bulk_import_progress")
      .select("*")
      .eq("admin_id", userId)
      .maybeSingle();
    if (error) return json(res, 500, { error: "Could not load import progress" });
    return json(res, 200, { progress: progress || null, sourceRoot });
  }

  const action = String(req.body?.action || "next");
  if (!["next", "reset"].includes(action)) return json(res, 400, { error: "Unknown action" });

  try {
    if (action === "reset") {
      const { error } = await admin.from("waves_bulk_import_progress").delete().eq("admin_id", userId);
      if (error) throw error;
    }

    let { data: progress, error: progressError } = await admin
      .from("waves_bulk_import_progress")
      .select("*")
      .eq("admin_id", userId)
      .maybeSingle();
    if (progressError) throw progressError;

    if (progress && progress.source_root_id !== sourceRoot) {
      const { error } = await admin.from("waves_bulk_import_progress").delete().eq("admin_id", userId);
      if (error) throw error;
      progress = null;
    }

    if (!progress) {
      const { data, error } = await admin.from("waves_bulk_import_progress").insert({
        admin_id: userId,
        source_root_id: sourceRoot,
        target_folder_id: targetFolder,
      }).select("*").single();
      if (error) throw error;
      progress = data;
    }

    if (progress.finished) return json(res, 200, { progress, complete: true });

    const googleAccess = await googleToken();
    const folders = await sourceFolders(googleAccess, sourceRoot);
    const folder = folders[progress.folder_index];

    if (!folder) {
      const { data: finished, error } = await admin
        .from("waves_bulk_import_progress")
        .update({ finished: true, updated_at: new Date().toISOString() })
        .eq("admin_id", userId)
        .select("*")
        .single();
      if (error) throw error;
      return json(res, 200, { progress: finished, complete: true });
    }

    const page = await listPage(googleAccess, folder.id, progress.page_token);
    const batch = await insertPage(admin, page.files || [], userId);

    const nextFolderIndex = page.nextPageToken ? progress.folder_index : progress.folder_index + 1;
    const complete = !page.nextPageToken && nextFolderIndex >= folders.length;
    const next = {
      folder_index: nextFolderIndex,
      page_token: page.nextPageToken || null,
      files_imported: progress.files_imported + batch.imported,
      files_existing: progress.files_existing + batch.existing,
      files_failed: progress.files_failed,
      finished: complete,
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await admin
      .from("waves_bulk_import_progress")
      .update(next)
      .eq("admin_id", userId)
      .select("*")
      .single();
    if (saveError) throw saveError;

    return json(res, 200, {
      progress: saved,
      batch: { ...batch, folder: folder.name },
      complete,
      sourceRoot,
    });
  } catch (error) {
    console.error("[waves-import-job]", error?.message || error);
    return json(res, 500, { error: error?.message || "Import failed" });
  }
}
