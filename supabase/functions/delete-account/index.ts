import { withSupabase } from "npm:@supabase/server@^1";

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function googleAccessToken() {
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN");
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
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) {
    console.error("[wavo] Drive token refresh failed", response.status, body?.error);
    return null;
  }
  return String(body.access_token);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let body: { confirmation?: string } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    if (body.confirmation !== "DELETE") {
      return Response.json(
        { error: "Type DELETE to confirm account deletion" },
        { status: 400 },
      );
    }

    const userId = ctx.userClaims?.id;
    if (!userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const admin = ctx.supabaseAdmin;

    // Google Drive attachments live outside Supabase, so remove those real
    // objects before the profile row cascades away their metadata. A retry is
    // safe because Drive returns 404 for files that were already deleted.
    const { data: driveFiles, error: driveFilesError } = await admin
      .from("drive_files")
      .select("drive_file_id")
      .eq("user_id", userId);

    if (driveFilesError) {
      console.error("[wavo] Drive file enumeration failed", driveFilesError);
      return Response.json(
        { error: "Account deletion could not be completed" },
        { status: 500 },
      );
    }

    if ((driveFiles || []).length > 0) {
      const driveToken = await googleAccessToken();
      if (!driveToken) {
        console.error("[wavo] Drive cleanup credentials are not configured");
        return Response.json(
          { error: "Account deletion could not be completed" },
          { status: 500 },
        );
      }

      for (const row of driveFiles || []) {
        const fileId = String(row?.drive_file_id || "");
        if (!fileId) continue;
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${driveToken}` },
          },
        );
        if (!response.ok && response.status !== 404) {
          const detail = await response.text().catch(() => "");
          console.error("[wavo] Drive cleanup failed", response.status, detail.slice(0, 500));
          return Response.json(
            { error: "Account deletion could not be completed" },
            { status: 500 },
          );
        }
      }
    }

    // Supabase Auth refuses a hard delete while a user still owns Storage
    // objects. Get exact owned paths with a service-role-only RPC, then remove
    // the real files via the Storage API rather than deleting metadata SQL.
    const { data: ownedObjects, error: objectsError } = await admin.rpc(
      "account_storage_objects_for_deletion",
      { target_user: userId },
    );

    if (objectsError) {
      console.error("[wavo] storage enumeration failed", objectsError);
      return Response.json(
        { error: "Account deletion could not be completed" },
        { status: 500 },
      );
    }

    const byBucket = new Map<string, string[]>();
    for (const row of ownedObjects || []) {
      const bucket = String(row?.bucket_id || "");
      const name = String(row?.name || "");
      if (!bucket || !name) continue;
      byBucket.set(bucket, [...(byBucket.get(bucket) || []), name]);
    }

    for (const [bucket, paths] of byBucket) {
      for (const batch of chunks(paths, 100)) {
        const { error: removeError } = await admin.storage.from(bucket).remove(batch);
        if (removeError) {
          console.error("[wavo] storage cleanup failed", { bucket, removeError });
          return Response.json(
            { error: "Account deletion could not be completed" },
            { status: 500 },
          );
        }
      }
    }

    const { error: cleanupError } = await admin.rpc("cleanup_account_for_deletion", {
      target_user: userId,
    });
    if (cleanupError) {
      console.error("[wavo] account cleanup failed", cleanupError);
      return Response.json(
        { error: "Account deletion could not be completed" },
        { status: 500 },
      );
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
    if (deleteError) {
      console.error("[wavo] auth user deletion failed", deleteError);
      return Response.json(
        { error: "Account deletion could not be completed" },
        { status: 500 },
      );
    }

    return Response.json({ deleted: true });
  }),
};
