import { withSupabase } from "npm:@supabase/server@^1";

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
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
