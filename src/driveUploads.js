import { supabase } from "./supabaseClient";

export const DRIVE_HARD_MAX_BYTES = 500 * 1024 * 1024;

const UPLOAD_UI_ID = "wavo-drive-upload-status";
let uploadUiTimer = null;

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function updateUploadUi({ fileName, detail, progress = null, state = "active" }) {
  if (typeof document === "undefined") return;
  if (uploadUiTimer) {
    clearTimeout(uploadUiTimer);
    uploadUiTimer = null;
  }

  let root = document.getElementById(UPLOAD_UI_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = UPLOAD_UI_ID;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    Object.assign(root.style, {
      position: "fixed",
      left: "50%",
      bottom: "calc(82px + env(safe-area-inset-bottom))",
      transform: "translateX(-50%)",
      zIndex: "10000",
      width: "min(430px, calc(100vw - 24px))",
      padding: "12px 14px",
      borderRadius: "16px",
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(10,16,30,.96)",
      boxShadow: "0 18px 50px rgba(0,0,0,.45)",
      backdropFilter: "blur(22px)",
      color: "#eef5ff",
      fontFamily: "inherit",
      pointerEvents: "none",
    });
    document.body.appendChild(root);
  }

  const safeProgress = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)));
  const accent = state === "error" ? "#ff7f91" : state === "done" ? "#72e6aa" : "#72d8ff";
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px">
      <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${String(fileName || "File").replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]))}</strong>
      <span style="flex:0 0 auto;font-size:11px;font-weight:800;color:${accent}">${safeProgress == null ? "" : `${safeProgress}%`}</span>
    </div>
    <div style="font-size:11px;color:#9eacc2;margin-bottom:${safeProgress == null ? 0 : 8}px">${String(detail || "Uploading…").replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]))}</div>
    ${safeProgress == null ? "" : `<div style="height:5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08)"><div style="height:100%;width:${safeProgress}%;border-radius:999px;background:${accent};transition:width .15s ease"></div></div>`}
  `;

  if (state === "done" || state === "error") {
    uploadUiTimer = setTimeout(() => {
      root?.remove();
      uploadUiTimer = null;
    }, state === "error" ? 4500 : 1600);
  }
}

async function authedRequest(path, body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("You're not signed in.");

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || "Couldn't prepare that upload.");
    error.code = payload?.code;
    error.maxBytes = payload?.maxBytes;
    error.tier = payload?.tier;
    throw error;
  }
  return payload;
}

async function driveRequest(body) {
  return authedRequest("/api/drive-upload", body);
}

async function resolveDriveFile(fileName, size) {
  return authedRequest("/api/drive-resolve", { fileName, size });
}

function putResumableFile(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.((event.loaded / event.total) * 100, event.loaded, event.total);
    };

    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        payload = {};
      }

      // Google can legitimately return a successful 200/201 with an empty or
      // unreadable response body in some embedded browsers. A 2xx means the
      // bytes reached Drive; Wavo can recover the created file ID server-side.
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }

      const error = new Error(
        xhr.status
          ? `Google Drive couldn't finish uploading that file (${xhr.status}).`
          : "Google Drive couldn't finish uploading that file.",
      );
      error.code = "DRIVE_UPLOAD_FAILED";
      reject(error);
    };

    xhr.onerror = () => {
      const error = new Error("The upload connection to Google Drive failed. Try again.");
      error.code = "DRIVE_UPLOAD_NETWORK";
      reject(error);
    };

    xhr.onabort = () => {
      const error = new Error("The upload was cancelled.");
      error.code = "DRIVE_UPLOAD_CANCELLED";
      reject(error);
    };

    xhr.send(file);
  });
}

export async function uploadDriveAttachment(file) {
  const mimeType = file.type || "application/octet-stream";
  updateUploadUi({
    fileName: file.name,
    detail: `Preparing ${formatBytes(file.size)} upload…`,
    progress: 0,
  });

  try {
    const start = await driveRequest({
      action: "start",
      fileName: file.name,
      mimeType,
      size: file.size,
    });

    updateUploadUi({
      fileName: file.name,
      detail: `Uploading ${formatBytes(file.size)} to Wavo storage…`,
      progress: 1,
    });

    const uploaded = await putResumableFile(start.uploadUrl, file, (percent, loaded) => {
      updateUploadUi({
        fileName: file.name,
        detail: `${formatBytes(loaded)} of ${formatBytes(file.size)} uploaded`,
        progress: Math.max(1, Math.min(99, percent)),
      });
    });

    updateUploadUi({
      fileName: file.name,
      detail: "Finalising attachment…",
      progress: 100,
    });

    let fileId = uploaded?.id;
    if (!fileId) {
      const recovered = await resolveDriveFile(file.name, file.size);
      fileId = recovered?.fileId;
    }
    if (!fileId) throw new Error("The file uploaded, but Wavo couldn't identify it in Drive.");

    try {
      const stored = await driveRequest({ action: "finish", fileId });
      updateUploadUi({
        fileName: file.name,
        detail: "Upload complete",
        progress: 100,
        state: "done",
      });
      return stored;
    } catch (error) {
      await driveRequest({ action: "delete", fileId }).catch(() => {});
      throw error;
    }
  } catch (error) {
    updateUploadUi({
      fileName: file.name,
      detail: error?.message || "Upload failed",
      progress: null,
      state: "error",
    });
    throw error;
  }
}

export async function deleteDriveAttachment(fileId) {
  if (!fileId) return;
  await driveRequest({ action: "delete", fileId });
}
