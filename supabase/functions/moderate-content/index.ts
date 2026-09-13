import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
function serviceKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default; const first = Object.values(parsed)[0]; if (typeof first === "string") return first; } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = serviceKey();
  if (!token || !url || !key) return json({ error: "unauthorized" }, 401);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body?.text || "").trim().slice(0, 12000);
  if (!text) return json({ allowed: true, flagged: false, categories: [] });

  // Message/post moderation intentionally stays first-party. Wavo does not send
  // ordinary user messages to a third-party AI provider in the background.
  const { data: allowed, error } = await admin.rpc("wavo_text_allowed", { p_text: text });
  if (error) {
    console.error("moderate-content first-party filter", error);
    return json({ allowed: false, flagged: true, categories: ["moderation-unavailable"], degraded: true }, 503);
  }
  if (allowed === false) return json({ allowed: false, flagged: true, categories: ["wavo-severe-filter"] });
  return json({ allowed: true, flagged: false, categories: [] });
});
