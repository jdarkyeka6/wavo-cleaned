import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const DEFAULT_SOURCE_ROOT = "1QREdguUC-VAZ-Me_kPbbJ1u3xjc-jf6K";
const DEFAULT_TARGET_FOLDER = "1o_KKvneQsX2hQlEzndJ4CXjM4qpeqUqD";
const PAGE_SIZE = 500;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const json = (res, status, body) => res.status(status).json(body);

function settings() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    userId: String(process.env.WAVES_IMPORT_USER_ID || ""),
    sourceRoot: String(process.env.WAVES_IMPORT_SOURCE_ROOT || DEFAULT_SOURCE_ROOT),
    targetFolder: String(process.env.WAVES_IMPORT_TARGET_FOLDER || DEFAULT_TARGET_FOLDER),
  };
}

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

async function listPage(token, folderId, pageToken) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,size,shortcutDetails(targetId,targetMimeType))",
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

function normalizeItem(item) {
  if (!item?.id) return null;
  if (item.mimeType !== SHORTCUT_MIME) return item;
  const targetId = item.shortcutDetails?.targetId;
  const targetMimeType = item.shortcutDetails?.targetMimeType;
  if (!targetId || !targetMimeType) return null;
  return { ...item, id: targetId, mimeType: targetMimeType, isShortcut: true };
}

function cleanLabel(value) {
  const cleaned = String(value || "")
    .replace(/^\s*\d+[+\s._-]*/g, "")
    .replace(/\b(reels?|videos?|bundle|clips?)\b/gi, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
  return (cleaned || "Viral Waves").slice(0, 120);
}

function tagsForPath(path) {
  const stop = new Set(["reel", "reels", "video", "videos", "clip", "clips", "bundle", "mega", "the", "and", "for", "with"]);
  const tags = String(path || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((tag) => tag.length > 2 && !stop.has(tag) && !/^\d+$/.test(tag));
  return [...new Set(tags)].slice(-10);
}

function channelForPath(path) {
  const text = String(path || "").toLowerCase();
  if (/\b(animal|animals|cat|cats|dog|dogs|pet|pets|wildlife|horse|bird)\b/.test(text)) return "animals";
  if (/\b(car|cars|auto|vehicle|vehicles|supercar|motor|motorsport)\b/.test(text)) return "cars";
  if (/\b(game|games|gaming|minecraft|fortnite|roblox)\b/.test(text)) return "gaming";
  if (/\b(travel|vacation|holiday|destination|beach|landscape|scenic|nature)\b/.test(text)) return "travel";
  if (/\b(satisfying|satisfy|asmr|cleaning|cutting|glass|oddly)\b/.test(text)) return "satisfying";
  if (/\b(funny|fail|fails|meme|memes|prank|comedy|joke|jokes)\b/.test(text)) return "funny";
  return "viral";
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

async function insertPage(admin, rawFiles, userId, folder) {
  const normalized = rawFiles.map(normalizeItem).filter(Boolean);
  const videos = normalized.filter((file) =>
    file?.id && VIDEO_MIME.has(file.mimeType) && (!file.size || Number(file.size) <= MAX_VIDEO_BYTES)
  );
  if (!videos.length) return { imported: 0, existing: 0, ignored: rawFiles.length };

  const ids = [...new Set(videos.map((file) => file.id))];
  const existing = await existingSourceIds(admin, ids);
  const seen = new Set();
  const fresh = videos.filter((file) => {
    if (existing.has(file.id) || seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  });

  if (!fresh.length) {
    return { imported: 0, existing: videos.length, ignored: rawFiles.length - videos.length };
  }

  const path = folder?.path || folder?.name || "Viral Waves";
  const title = cleanLabel(folder?.name || path);
  const tags = tagsForPath(path);
  const channel = channelForPath(path);

  // Stage third-party bundle media as drafts. The bundle's own licence requires
  // copying to the licensee's storage and modifying content/presentation before
  // distribution, so discovery/import must not silently publish untouched files.
  const rows = fresh.map((file) => ({
    source_drive_id: file.id,
    channel_slug: channel,
    title,
    caption: "",
    status: "draft",
    created_by: userId,
    video_provider: "google_drive",
    video_asset_id: file.id,
    playback_url: `https://drive.usercontent.google.com/download?id=${file.id}&export=download`,
    source_credit: "PLR/MRR bundle import",
    tags,
    tagging_status: "pending",
  }));

  const { data: inserted, error: insertError } = await admin
    .from("waves_curated_clips")
    .insert(rows)
    .select("id,source_drive_id");
  if (insertError) throw insertError;

  return {
    imported: inserted?.length || 0,
    existing: videos.length - fresh.length,
    ignored: rawFiles.length - videos.length,
  };
}

function publicProgress(progress) {
  if (!progress) return null;
  const { folder_queue: _queue, ...rest } = progress;
  return rest;
}

function rootQueue(sourceRoot) {
  return [{ id: sourceRoot, name: "275.000+ REELS MEGA BUNDLE", path: "275.000+ REELS MEGA BUNDLE" }];
}

async function adminContext() {
  const opts = settings();
  if (!opts.supabaseUrl || !opts.serviceKey || !/^[0-9a-f-]{36}$/i.test(opts.userId)) {
    return { error: { status: 503, body: { error: "Import job is not configured" } } };
  }

  const admin = createClient(opts.supabaseUrl, opts.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", opts.userId)
    .maybeSingle();
  if (profileError || !profile?.is_admin) {
    return { error: { status: 403, body: { error: "Configured import owner is not an admin" } } };
  }
  return { admin, ...opts };
}

export async function readImportProgress() {
  try {
    const ctx = await adminContext();
    if (ctx.error) return ctx.error;
    const { data: progress, error } = await ctx.admin
      .from("waves_bulk_import_progress")
      .select("*")
      .eq("admin_id", ctx.userId)
      .maybeSingle();
    if (error) return { status: 500, body: { error: "Could not load import progress" } };
    return { status: 200, body: { progress: publicProgress(progress), sourceRoot: ctx.sourceRoot } };
  } catch (error) {
    console.error("[waves-import-progress]", error?.message || error);
    return { status: 500, body: { error: error?.message || "Could not load import progress" } };
  }
}

export async function runImportPage(action = "next") {
  if (!["next", "reset"].includes(action)) return { status: 400, body: { error: "Unknown action" } };

  try {
    const ctx = await adminContext();
    if (ctx.error) return ctx.error;
    const { admin, userId, sourceRoot, targetFolder } = ctx;

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
      const queue = rootQueue(sourceRoot);
      const { data, error } = await admin.from("waves_bulk_import_progress").insert({
        admin_id: userId,
        source_root_id: sourceRoot,
        target_folder_id: targetFolder,
        folder_queue: queue,
        folders_discovered: queue.length,
      }).select("*").single();
      if (error) throw error;
      progress = data;
    }

    if (progress.finished) {
      return { status: 200, body: { progress: publicProgress(progress), complete: true, sourceRoot } };
    }

    let queue = Array.isArray(progress.folder_queue) && progress.folder_queue.length
      ? progress.folder_queue
      : rootQueue(sourceRoot);
    const folderIndex = Number(progress.folder_index || 0);
    const folder = queue[folderIndex];

    if (!folder) {
      const { data: finished, error } = await admin
        .from("waves_bulk_import_progress")
        .update({ finished: true, updated_at: new Date().toISOString() })
        .eq("admin_id", userId)
        .select("admin_id,source_root_id,target_folder_id,folder_index,page_token,files_imported,files_existing,files_failed,files_ignored,folders_discovered,last_error,updated_at,finished")
        .single();
      if (error) throw error;
      return { status: 200, body: { progress: finished, complete: true, sourceRoot } };
    }

    const googleAccess = await googleToken();
    const page = await listPage(googleAccess, folder.id, progress.page_token);
    const normalized = (page.files || []).map(normalizeItem).filter(Boolean);
    const childFolders = normalized.filter((file) => file.mimeType === FOLDER_MIME);

    if (childFolders.length) {
      const queuedIds = new Set(queue.map((entry) => entry.id));
      const additions = [];
      for (const child of childFolders) {
        if (queuedIds.has(child.id)) continue;
        queuedIds.add(child.id);
        additions.push({
          id: child.id,
          name: String(child.name || "Folder").slice(0, 240),
          path: `${folder.path || folder.name || "Bundle"}/${String(child.name || "Folder")}`.slice(0, 2000),
        });
      }
      if (additions.length) queue = queue.concat(additions);
    }

    const batch = await insertPage(admin, page.files || [], userId, folder);
    const nextFolderIndex = page.nextPageToken ? folderIndex : folderIndex + 1;
    const complete = !page.nextPageToken && nextFolderIndex >= queue.length;
    const next = {
      folder_queue: queue,
      folders_discovered: queue.length,
      folder_index: nextFolderIndex,
      page_token: page.nextPageToken || null,
      files_imported: Number(progress.files_imported || 0) + batch.imported,
      files_existing: Number(progress.files_existing || 0) + batch.existing,
      files_failed: Number(progress.files_failed || 0),
      files_ignored: Number(progress.files_ignored || 0) + batch.ignored,
      finished: complete,
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await admin
      .from("waves_bulk_import_progress")
      .update(next)
      .eq("admin_id", userId)
      .select("admin_id,source_root_id,target_folder_id,folder_index,page_token,files_imported,files_existing,files_failed,files_ignored,folders_discovered,last_error,updated_at,finished")
      .single();
    if (saveError) throw saveError;

    return {
      status: 200,
      body: {
        progress: saved,
        batch: { ...batch, folder: folder.name, path: folder.path },
        complete,
        sourceRoot,
      },
    };
  } catch (error) {
    console.error("[waves-import-job]", error?.message || error);
    return { status: 500, body: { error: error?.message || "Import failed" } };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const configuredSecret = String(process.env.WAVES_IMPORT_JOB_SECRET || "");
  const auth = String(req.headers.authorization || "");
  const suppliedSecret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!configuredSecret || suppliedSecret !== configuredSecret) return json(res, 401, { error: "Unauthorized" });

  if (req.method === "GET") {
    const result = await readImportProgress();
    return json(res, result.status, result.body);
  }

  const result = await runImportPage(String(req.body?.action || "next"));
  return json(res, result.status, result.body);
}
