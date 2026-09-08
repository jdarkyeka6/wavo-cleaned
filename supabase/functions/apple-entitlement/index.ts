import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { Environment, SignedDataVerifier } from "npm:@apple/app-store-server-library@3.1.0";
import { Buffer } from "node:buffer";

const BUNDLE_ID = "lol.wavo.app";
const APPLE_APP_ID = 6792405668;
const PRODUCTS: Record<string, "premium" | "pro"> = {
  "lol.wavo.premium.monthly": "premium",
  "lol.wavo.pro.monthly": "pro",
};
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8" },
});
function serviceKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default; const first = Object.values(parsed)[0]; if (typeof first === "string") return first; } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
let rootsPromise: Promise<Buffer[]> | null = null;
function appleRoots() {
  if (!rootsPromise) {
    rootsPromise = Promise.all([
      "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
      "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
    ].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Apple root download failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }));
  }
  return rootsPromise;
}
function hintedEnvironment(jws: string) {
  try {
    const payload = JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
    return String(payload?.environment || "").toLowerCase() === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
  } catch { return Environment.SANDBOX; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = serviceKey();
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!url || !key || !token) return json({ error: "unauthorized" }, 401);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const jws = String(body?.jwsRepresentation || "").trim();
  if (!jws || jws.split(".").length !== 3) return json({ error: "missing_transaction" }, 400);

  try {
    const environment = hintedEnvironment(jws);
    const verifier = new SignedDataVerifier(await appleRoots(), true, environment, BUNDLE_ID, environment === Environment.PRODUCTION ? APPLE_APP_ID : undefined);
    const tx: any = await verifier.verifyAndDecodeTransaction(jws);
    const productId = String(tx?.productId || "");
    const purchasedTier = PRODUCTS[productId];
    if (!purchasedTier) return json({ error: "unknown_product" }, 400);
    if (String(tx?.bundleId || "") !== BUNDLE_ID) return json({ error: "wrong_bundle" }, 400);
    const accountToken = String(tx?.appAccountToken || "").toLowerCase();
    if (!accountToken || accountToken !== String(user.id).toLowerCase()) return json({ error: "wrong_wavo_account", message: "This Apple purchase belongs to a different Wavo account." }, 403);
    const expiresMs = Number(tx?.expiresDate || tx?.expirationDate || 0);
    const revoked = Number(tx?.revocationDate || 0) > 0;
    if (revoked || !Number.isFinite(expiresMs) || expiresMs <= Date.now()) return json({ error: "subscription_inactive" }, 400);

    const { data: current } = await admin.from("profiles").select("tier,is_premium,premium_until").eq("id", user.id).maybeSingle();
    const currentPro = Boolean(current?.is_premium) && ["pro", "vip"].includes(String(current?.tier || "").toLowerCase()) && (!current?.premium_until || new Date(current.premium_until).getTime() > Date.now());
    const tier = currentPro && purchasedTier === "premium" ? "pro" : purchasedTier;
    const premiumUntil = new Date(expiresMs).toISOString();
    const { error: profileError } = await admin.from("profiles").update({ is_premium: true, tier, premium_until: premiumUntil }).eq("id", user.id);
    if (profileError) throw profileError;
    const { error: entitlementError } = await admin.from("store_entitlements").upsert({
      user_id: user.id,
      provider: "apple",
      product_id: productId,
      transaction_id: String(tx?.transactionId || ""),
      original_transaction_id: String(tx?.originalTransactionId || tx?.transactionId || ""),
      environment: String(tx?.environment || environment),
      expires_at: premiumUntil,
      active: true,
      verified_at: new Date().toISOString(),
    }, { onConflict: "provider,transaction_id" });
    if (entitlementError) throw entitlementError;
    return json({ ok: true, tier, premiumUntil, productId });
  } catch (error) {
    console.error("apple-entitlement verify", error);
    return json({ error: "verification_failed", message: "Apple could not verify this subscription." }, 400);
  }
});
