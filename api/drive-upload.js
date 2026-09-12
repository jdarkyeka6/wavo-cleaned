import { createClient } from "@supabase/supabase-js";

const MB = 1024 * 1024;
const FILE_LIMITS = {
  free: 25 * MB,
  premium: 50 * MB,
  plus: 100 * MB,
  pro: 500 * MB,
  vip: 500 * MB,
};

function json(res, status, body) {
  return res.status(status).json(body);
}

function cleanName(value) {
  return String(value || "attachment")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 200) || "attachment";
}

function effectiveTier(profile) {
  const raw = String(profile?.tier || "free").toLowerCase();
  const until = profile?.premium_until ? new Date(profile.premium_until) : null;
  const active = Boolean(profile?.is_premium) && (!until || Number.isNaN(until.getTime()) || until > new Date());
  if (!active) return "free";

  if (String(profile?.entitlement_source || "").toLowerCase() === "stripe_plus") {
    return "plus";
  }
  if (FILE_LIMITS[raw]) return raw;
  return "premium";
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    console.error("[drive-upload] token refresh failed", response.status, payload?.error);
    return null;
  }
  return payload.access_token;
}

async function driveJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function ensureWavoFolder(token) {
  const query = encodeURIComponent(
    "mimeType = 'application/vnd.google-apps.folder' and name = 'Wavo Storage' and trashed = false and appProperties has { key='wavoManaged' and value='true' }",
  );
  const fields = encodeURIComponent("files(id,name,createdTime)");
  const { response: searchResponse, payload: search } = await driveJson(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&pageSize=1&orderBy=createdTime&fields=${fields}`,
    token,
  );
  if (!searchResponse.ok) {
    throw new Error(search?.error?.message || "Could not find Wavo's Drive folder.");
  }
  if (search?.files?.[0]?.id) return search.files[0].id;

  const { response: createResponse, payload: created } = await driveJson(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wavo Storage",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { wavoManaged: "true" },
      }),
    },
  );
  if (!createResponse.ok || !created?.id) {
    throw new Error(created?.error?.message || "Could not create Wavo's Drive folder.");
  }
  return created.id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(res, 500, { error: "Server auth is not configured." });
  }

  const authHeader = String(req.headers.authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) return json(res, 401, { error: "Sign in to upload files." });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json(res, 401, { error: "Your session expired. Sign in again." });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("tier,is_premium,premium_until,entitlement_source,banned")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) return json(res, 403, { error: "Your Wavo profile could not be loaded." });
  if (profile.banned) return json(res, 403, { error: "This account cannot upload files." });

  const tier = effectiveTier(profile);
  const maxBytes = FILE_LIMITS[tier] || FILE_LIMITS.free;
  const action = String(req.body?.action || "");

  const googleToken = await googleAccessToken();
  if (!googleToken) {
    return json(res, 503, {
      code: "DRIVE_NOT_CONFIGURED",
      error: "Wavo large-file storage is still being connected.",
    });
  }

  if (action === "start") {
    const fileName = cleanName(req.body?.fileName);
    const mimeType = String(req.body?.mimeType || "application/octet-stream").slice(0, 200);
    const size = Number(req.body?.size);

    if (!Number.isFinite(size) || size <= 0 || !Number.isSafeInteger(size)) {
      return json(res, 400, { error: "Invalid file size." });
    }
    if (size > maxBytes) {
      return json(res, 413, {
        code: "FILE_TOO_LARGE",
        tier,
        maxBytes,
        error: `Your ${tier === "free" ? "Free" : tier[0].toUpperCase() + tier.slice(1)} plan can send files up to ${Math.round(maxBytes / MB)} MB.`,
      });
    }

    let folderId;
    try {
      folderId = await ensureWavoFolder(googleToken);
    } catch (error) {
      console.error("[drive-upload] folder setup failed", error);
      return json(res, 502, { error: "Wavo could not prepare Google Drive storage." });
    }

    const metadata = {
      name: fileName,
      mimeType,
      parents: [folderId],
      appProperties: {
        wavoUserId: user.id,
        wavoSource: "chat",
      },
    };

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify(metadata),
      },
    );

    const uploadUrl = response.headers.get("location");
    if (!response.ok || !uploadUrl) {
      const errorBody = await response.text().catch(() => "");
      console.error("[drive-upload] couldn't start upload", response.status, errorBody.slice(0, 500));
      return json(res, 502, { error: "Google Drive could not start that upload." });
    }

    return json(res, 200, { uploadUrl, tier, maxBytes });
  }

  if (action === "finish") {
    const fileId = String(req.body?.fileId || "").trim();
    if (!fileId) return json(res, 400, { error: "Missing uploaded file ID." });

    const fields = encodeURIComponent(
      "id,name,mimeType,size,webContentLink,webViewLink,appProperties,permissions(id,type,role)",
    );
    const { response: metaResponse, payload: meta } = await driveJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`,
      googleToken,
    );

    if (!metaResponse.ok || meta?.appProperties?.wavoUserId !== user.id) {
      return json(res, 403, { error: "That uploaded file does not belong to this Wavo account." });
    }

    const uploadedSize = Number(meta.size || 0);
    if (uploadedSize > maxBytes) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${googleToken}` },
      }).catch(() => {});
      return json(res, 413, { error: "That file is over your plan's upload limit." });
    }

    const hasPublicReader = Array.isArray(meta.permissions)
      && meta.permissions.some((permission) => permission?.type === "anyone" && permission?.role === "reader");

    if (!hasPublicReader) {
      const { response: permissionResponse, payload: permissionError } = await driveJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
        googleToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
        },
      );
      if (!permissionResponse.ok) {
        console.error("[drive-upload] sharing failed", permissionResponse.status, permissionError?.error?.message);
        return json(res, 502, { error: "The file uploaded, but Wavo could not make it shareable." });
      }
    }

    const { data: stored, error: storeError } = await admin
      .from("drive_files")
      .upsert(
        {
          user_id: user.id,
          drive_file_id: fileId,
          file_name: cleanName(meta.name),
          mime_type: String(meta.mimeType || "application/octet-stream"),
          size_bytes: uploadedSize,
        },
        { onConflict: "drive_file_id" },
      )
      .select("id")
      .single();

    if (storeError || !stored) {
      console.error("[drive-upload] metadata insert failed", storeError);
      return json(res, 500, { error: "The file uploaded, but Wavo could not finish saving it." });
    }

    const url = meta.webContentLink
      || meta.webViewLink
      || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

    return json(res, 200, {
      fileId,
      url,
      fileName: cleanName(meta.name),
      mimeType: meta.mimeType || "application/octet-stream",
      size: uploadedSize,
    });
  }

  if (action === "delete") {
    const fileId = String(req.body?.fileId || "").trim();
    if (!fileId) return json(res, 400, { error: "Missing file ID." });

    const { data: row, error: rowError } = await admin
      .from("drive_files")
      .select("drive_file_id")
      .eq("drive_file_id", fileId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (rowError) return json(res, 500, { error: "Could not verify that file." });
    if (!row) return json(res, 404, { error: "File not found." });

    const deleteResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      { method: "DELETE", headers: { Authorization: `Bearer ${googleToken}` } },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      return json(res, 502, { error: "Google Drive could not delete that file." });
    }

    await admin.from("drive_files").delete().eq("drive_file_id", fileId).eq("user_id", user.id);
    return json(res, 200, { deleted: true });
  }

  return json(res, 400, { error: "Unknown upload action." });
}
