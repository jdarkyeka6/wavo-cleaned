import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return parsed.default as string;
    } catch {
      // Fall through to the legacy service-role key while projects migrate.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Authentication required" }, 401);

  let body: { confirmation?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  if (body.confirmation !== "DELETE") {
    return json({ error: "Type DELETE to confirm account deletion" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getSecretKey();
  if (!url || !secretKey) return json({ error: "Server configuration error" }, 500);

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Authentication required" }, 401);

  // A hard Auth deletion is rejected while a user owns Storage objects. Get the
  // exact paths with a service-role-only RPC, then remove the real files using
  // the Storage API rather than deleting storage.objects metadata directly.
  const { data: ownedObjects, error: objectsError } = await admin.rpc(
    "account_storage_objects_for_deletion",
    { target_user: user.id },
  );

  if (objectsError) {
    console.error("[wavo] storage enumeration failed", objectsError);
    return json({ error: "Account deletion could not be completed" }, 500);
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
        return json({ error: "Account deletion could not be completed" }, 500);
      }
    }
  }

  const { error: cleanupError } = await admin.rpc("cleanup_account_for_deletion", {
    target_user: user.id,
  });
  if (cleanupError) {
    console.error("[wavo] account cleanup failed", cleanupError);
    return json({ error: "Account deletion could not be completed" }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, false);
  if (deleteError) {
    console.error("[wavo] auth user deletion failed", deleteError);
    return json({ error: "Account deletion could not be completed" }, 500);
  }

  return json({ deleted: true });
});
