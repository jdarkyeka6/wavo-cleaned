import { supabase } from "./supabaseClient";

export const DRIVE_HARD_MAX_BYTES = 500 * 1024 * 1024;

async function driveRequest(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("You're not signed in.");

  const response = await fetch("/api/drive-upload", {
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

export async function uploadDriveAttachment(file) {
  const mimeType = file.type || "application/octet-stream";
  const start = await driveRequest({
    action: "start",
    fileName: file.name,
    mimeType,
    size: file.size,
  });

  const uploadResponse = await fetch(start.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Range": `bytes 0-${file.size - 1}/${file.size}`,
    },
    body: file,
  });

  const uploaded = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploaded?.id) {
    throw new Error("Google Drive couldn't finish uploading that file.");
  }

  try {
    return await driveRequest({ action: "finish", fileId: uploaded.id });
  } catch (error) {
    // The file exists in Drive but was not attached to a message. Ask the
    // server to clean it up when possible so failed sends do not leak storage.
    await driveRequest({ action: "delete", fileId: uploaded.id }).catch(() => {});
    throw error;
  }
}

export async function deleteDriveAttachment(fileId) {
  if (!fileId) return;
  await driveRequest({ action: "delete", fileId });
}
