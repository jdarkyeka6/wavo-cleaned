import { createClient } from "@supabase/supabase-js";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";

const BUNDLE_ID = "lol.wavo.app";
const APPLE_APP_ID = 6792405668;
const PRODUCTS = {
  "lol.wavo.premium.monthly": "premium",
  "lol.wavo.pro.monthly": "pro",
};

let rootPromise;
async function appleRoots() {
  if (!rootPromise) {
    rootPromise = Promise.all([
      "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
      "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
    ].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Apple root download failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }));
  }
  return rootPromise;
}

function untrustedEnvironment(jws) {
  try {
    const payload = JSON.parse(Buffer.from(String(jws).split(".")[1], "base64url").toString("utf8"));
    return String(payload?.environment || "").toLowerCase() === "production" ? Environment.PRODUCTION : Environment.SANDBOX;
  } catch {
    return Environment.SANDBOX;
  }
}

function isoFromAppleMs(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server configuration missing" });

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Not signed in" });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (authError || !user) return res.status(401).json({ error: "Session expired" });

    const jws = String(req.body?.jwsRepresentation || "").trim();
    if (!jws || jws.split(".").length !== 3) return res.status(400).json({ error: "Missing StoreKit transaction" });

    const environment = untrustedEnvironment(jws);
    const roots = await appleRoots();
    const verifier = new SignedDataVerifier(
      roots,
      true,
      environment,
      BUNDLE_ID,
      environment === Environment.PRODUCTION ? APPLE_APP_ID : undefined,
    );
    const transaction = await verifier.verifyAndDecodeTransaction(jws);

    const productId = String(transaction?.productId || "");
    const purchasedTier = PRODUCTS[productId];
    if (!purchasedTier) return res.status(400).json({ error: "Unknown Wavo subscription" });
    if (String(transaction?.bundleId || "") !== BUNDLE_ID) return res.status(400).json({ error: "Wrong app receipt" });

    const accountToken = String(transaction?.appAccountToken || "").toLowerCase();
    if (!accountToken || accountToken !== String(user.id).toLowerCase()) {
      return res.status(403).json({ error: "This purchase belongs to a different Wavo account" });
    }

    const expirationMs = Number(transaction?.expiresDate || transaction?.expirationDate || 0);
    const revoked = Number(transaction?.revocationDate || 0) > 0;
    const active = !revoked && expirationMs > Date.now();
    if (!active) return res.status(400).json({ error: "Subscription is not active" });

    const { data: current } = await admin.from("profiles").select("tier,is_premium,premium_until").eq("id", user.id).maybeSingle();
    const currentPro = Boolean(current?.is_premium) && ["pro", "vip"].includes(String(current?.tier || "").toLowerCase()) && (!current?.premium_until || new Date(current.premium_until).getTime() > Date.now());
    const tier = currentPro && purchasedTier === "premium" ? "pro" : purchasedTier;
    const premiumUntil = isoFromAppleMs(expirationMs);

    const { error: updateError } = await admin.from("profiles").update({
      is_premium: true,
      tier,
      premium_until: premiumUntil,
    }).eq("id", user.id);
    if (updateError) throw updateError;

    await admin.from("store_entitlements").upsert({
      user_id: user.id,
      provider: "apple",
      product_id: productId,
      transaction_id: String(transaction?.transactionId || ""),
      original_transaction_id: String(transaction?.originalTransactionId || transaction?.transactionId || ""),
      environment: String(transaction?.environment || ""),
      expires_at: premiumUntil,
      active: true,
      verified_at: new Date().toISOString(),
    }, { onConflict: "provider,transaction_id" });

    return res.status(200).json({ ok: true, tier, premiumUntil, productId });
  } catch (err) {
    console.error("apple entitlement verification failed", err);
    return res.status(400).json({ error: "Apple could not verify this subscription." });
  }
}
