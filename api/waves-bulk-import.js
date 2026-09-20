import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const SOURCE_ROOT = "1QREdguUC-VAZ-Me_kPbbJ1u3xjc-jf6K";
const TARGET_FOLDER = "1o_KKvneQsX2hQlEzndJ4CXjM4qpeqUqD";
const LIMIT = 3;
const categories = new Set(["funny", "animals", "gaming", "cars", "travel", "satisfying"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);
const reply = (res, code, data) => res.status(code).json(data);

async function googleToken() {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Drive credentials are not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("Could not connect to Wavo's private Drive");
  return body.access_token;
}

async function google(path, token, options = {}) {
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    ...options,
    headers: { Authorization: "Bearer " + token, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Google Drive: " + (body?.error?.message || response.status));
  return body;
}

async function listFiles(token, folder, pageToken) {
  const params = new URLSearchParams({
    q: "'" + folder + "' in parents and trashed = false",
    fields: "nextPageToken,files(id,name,mimeType,size,thumbnailLink)",
    pageSize: String(LIMIT), orderBy: "name",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return google("files?" + params, token);
}

async function subfolders(token) {
  const params = new URLSearchParams({
    q: "'" + SOURCE_ROOT + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "nextPageToken,files(id,name)", pageSize: "100", orderBy: "name",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  const result = await google("files?" + params, token);
  if (result.nextPageToken) throw new Error("Unexpectedly large source folder");
  if (!result.files?.length) throw new Error("The Funny Fails collection is not accessible to Wavo's Drive account");
  return result.files.sort((a, b) => {
    const n = (value) => Number(value.name.match(/\[(\d+)/)?.[1] || 0);
    return n(a) - n(b);
  });
}

async function tagThumbnail(thumbnail, googleAccess, access, supabaseUrl, serviceKey, filename) {
  if (!thumbnail) return { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  const parsed = new URL(thumbnail);
  if (parsed.protocol !== "https:" || !/(^|\.)(googleusercontent\.com|google\.com|ggpht\.com)$/.test(parsed.hostname)) {
    return { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  }
  const image = await fetch(thumbnail, { headers: { Authorization: "Bearer " + googleAccess }, redirect: "follow" });
  const size = Number(image.headers.get("content-length") || 0);
  const mime = String(image.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!image.ok || (size && size > 850000) || !["image/jpeg","image/png","image/webp"].includes(mime)) {
    return { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  }
  const bytes = Buffer.from(await image.arrayBuffer());
  if (bytes.length > 850000) return { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  const response = await fetch(supabaseUrl + "/functions/v1/waves-tag-video", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      apikey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || serviceKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ image: "data:" + mime + ";base64," + bytes.toString("base64"), filename }),
  });
  if (!response.ok) return { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  const labels = await response.json();
  return {
    tags: Array.isArray(labels.tags) ? labels.tags.slice(0, 8) : [],
    tagging_status: labels.confidence === "low" ? "needs_review" : "complete",
    channel: categories.has(labels.channel) ? labels.channel : "funny",
    risk: labels.risk === "needs_review" ? "needs_review" : "clear",
  };
}

async function processFile(file, context) {
  const { admin, token, googleAccess, userId, supabaseUrl, serviceKey } = context;
  if (!VIDEO_MIME.has(file.mimeType) || !file.id) return { skipped: true };
  if (Number(file.size || 0) > 100 * 1024 * 1024) return { skipped: true, reason: "Video over 100 MB" };

  const { data: existing, error: findError } = await admin.from("waves_curated_clips")
    .select("id,status,video_asset_id,video_provider,moderation_state,tags,tagging_status")
    .eq("source_drive_id", file.id).maybeSingle();
  if (findError) throw findError;
  let clip = existing;
  if (clip && (clip.moderation_state === "removed" || clip.moderation_state === "hidden")) return { skipped: true };

  if (clip) {
    const { data: previous } = await admin.from("waves_curated_reviews")
      .select("decision").eq("clip_id", clip.id).maybeSingle();
    if (["no","maybe"].includes(previous?.decision)) return { skipped: true, reason: "Previously rejected or deferred" };
    if (clip.status === "published" && clip.tagging_status === "complete") return { skipped: true };
  }

  let driveId = clip?.video_provider === "google_drive" ? clip.video_asset_id : null;
  let thumbnail = file.thumbnailLink;
  if (!driveId) {
    const copied = await google("files/" + encodeURIComponent(file.id) + "/copy?fields=id,name,size,mimeType,thumbnailLink&supportsAllDrives=true", googleAccess, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "waves-funny-" + file.id + ".mp4",
        parents: [TARGET_FOLDER],
        appProperties: { wavoSource: "waves-curated", wavoSourceFileId: file.id },
      }),
    });
    driveId = copied.id;
    thumbnail = copied.thumbnailLink || thumbnail;
    if (!driveId) throw new Error("Drive copy returned no file ID");
  }

  if (!clip) {
    const { data: added, error: insertError } = await admin.from("waves_curated_clips").insert({
      source_drive_id: file.id,
      channel_slug: "funny", title: "Funny Waves", caption: "",
      status: "draft", created_by: userId, video_provider: "google_drive", video_asset_id: driveId,
      playback_url: "https://drive.usercontent.google.com/download?id=" + driveId + "&export=download",
      tags: ["funny","fails"], tagging_status: "pending",
    }).select("id,status,tags,tagging_status").single();
    if (insertError) throw insertError;
    clip = added;
    const { error: reviewError } = await admin.from("waves_curated_reviews").insert({
      clip_id: clip.id,
      drive_source_url: "https://drive.google.com/file/d/" + file.id + "/view",
      source_filename: String(file.name || "").slice(0, 240),
      decision: "yes", decided_at: new Date().toISOString(), decided_by: userId,
      rights_verified: true, audio_verified: true, edited: false, content_approved: false,
      licence_notes: "Collection owner attested to video and audio publishing rights and authorised bulk release. Content handled through reporting, not manual per-video approval.",
    });
    if (reviewError) throw reviewError;
  } else if (!clip.video_asset_id) {
    const { error: updateError } = await admin.from("waves_curated_clips").update({
      video_provider: "google_drive", video_asset_id: driveId,
      playback_url: "https://drive.usercontent.google.com/download?id=" + driveId + "&export=download",
    }).eq("id", clip.id);
    if (updateError) throw updateError;
  }

  // Reuse previous owner confirmation from the conversation only for this
  // explicitly selected collection. The note makes the attestation auditable.
  const { error: rightsError } = await admin.from("waves_curated_reviews").update({
    rights_verified: true, audio_verified: true,
    licence_notes: "Collection owner attested to video and audio publishing rights and authorised bulk release. Not independently verified by Wavo.",
  }).eq("clip_id", clip.id);
  if (rightsError) throw rightsError;

  let tagResult = { tags: [], tagging_status: "unavailable", channel: "funny", risk: "clear" };
  try {
    tagResult = await tagThumbnail(thumbnail, googleAccess, token, supabaseUrl, serviceKey, file.name);
  } catch (error) {
    console.warn("[waves-import] video thumbnail could not be analysed", clip.id, error?.message);
  }
  const tags = [...new Set(["funny","fails",...tagResult.tags])].slice(0, 10);
  const needsReview = tagResult.risk === "needs_review";
  const { error: labelError } = await admin.from("waves_curated_clips").update({
    tags, tagging_status: needsReview ? "needs_review" : tagResult.tagging_status,
    tags_generated_at: tagResult.tagging_status === "complete" ? new Date().toISOString() : null,
  }).eq("id", clip.id);
  if (labelError) throw labelError;

  if (needsReview) return { pending: true, tagged: true };
  // Tags are for recommendation, not a substitute for full-video safety review.
  // The owner explicitly chose report-first moderation for this collection.
  if (clip.status !== "published") {
    const { error: publicationError } = await admin.from("waves_curated_clips")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", clip.id).eq("status", "draft");
    if (publicationError) throw publicationError;
    return { imported: true, tagged: tagResult.tagging_status === "complete" };
  }
  return { skipped: true, tagged: tagResult.tagging_status === "complete" };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return reply(res, 405, { error: "Method not allowed" });
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return reply(res, 401, { error: "Sign in first" });
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return reply(res, 503, { error: "Server storage is not configured" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authUser } = await admin.auth.getUser(token);
  const userId = authUser?.user?.id;
  if (!userId) return reply(res, 401, { error: "Session expired" });
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (!profile?.is_admin) return reply(res, 403, { error: "Waves Studio only" });
  const { data: state, error: stateError } = await admin.from("waves_bulk_import_progress")
    .select("*").eq("admin_id", userId).maybeSingle();
  if (stateError) return reply(res, 500, { error: "Could not load import progress" });
  if (req.method === "GET") return reply(res, 200, { progress: state || null });
  if (!["start","next"].includes(req.body?.action)) return reply(res, 400, { error: "Unknown action" });

  // The source and destination are server constants, not caller-controlled
  // URLs or arbitrary folder IDs.
  try {
    const googleAccess = await googleToken();
    const folders = await subfolders(googleAccess);
    let progress = state;
    if (!progress) {
      const { data, error } = await admin.from("waves_bulk_import_progress").insert({
        admin_id: userId, source_root_id: SOURCE_ROOT, target_folder_id: TARGET_FOLDER,
      }).select("*").single();
      if (error) throw error;
      progress = data;
    }
    if (progress.finished) return reply(res, 200, { progress, complete: true });
    const folder = folders[progress.folder_index];
    if (!folder) return reply(res, 200, { progress: { ...progress, finished: true }, complete: true });
    const page = await listFiles(googleAccess, folder.id, progress.page_token);
    let imported = 0, existing = 0, failed = 0, tagged = 0;
    let lastError = "";
    for (const file of page.files || []) {
      try {
        const result = await processFile(file, { admin, token, googleAccess, userId, supabaseUrl, serviceKey });
        if (result.imported) imported++;
        else if (result.skipped) existing++;
        else if (result.pending) existing++;
        if (result.tagged) tagged++;
      } catch (error) {
        failed++;
        lastError = error?.message || "Unknown import error";
        console.error("[waves-import]", file?.id, lastError);
      }
    }
    // Store the cursor only after the entire page has been attempted. Failed
    // files are retained in the error count and can be retried via reset.
    const nextIndex = page.nextPageToken ? progress.folder_index : progress.folder_index + 1;
    const finished = nextIndex >= folders.length;
    const next = {
      folder_index: nextIndex, page_token: page.nextPageToken || null,
      files_imported: progress.files_imported + imported,
      files_existing: progress.files_existing + existing,
      files_failed: progress.files_failed + failed,
      finished, last_error: lastError || null, updated_at: new Date().toISOString(),
    };
    const { data: saved, error: saveError } = await admin.from("waves_bulk_import_progress")
      .update(next).eq("admin_id", userId).select("*").single();
    if (saveError) throw saveError;
    return reply(res, 200, { progress: saved, batch: { imported, existing, failed, tagged }, complete: finished });
  } catch (error) {
    console.error("[waves-import] failure", error?.message);
    return reply(res, 502, { error: error?.message || "The import could not continue" });
  }
}
