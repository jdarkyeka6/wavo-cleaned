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
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!token || !url || !key) return json({ error: "unauthorized" }, 401);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body?.text || "").trim().slice(0, 12000);
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (!text && !imageUrl) return json({ allowed: true, flagged: false, categories: [] });

  if (text) {
    const { data: allowed } = await admin.rpc("wavo_text_allowed", { p_text: text });
    if (allowed === false) return json({ allowed: false, flagged: true, categories: ["wavo-severe-filter"] });
  }
  if (!openAiKey) return json({ allowed: true, flagged: false, categories: [], degraded: true });
  const input: any[] = [];
  if (text) input.push({ type: "text", text });
  if (imageUrl) input.push({ type: "image_url", image_url: { url: imageUrl } });
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { authorization: `Bearer ${openAiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  });
  if (!response.ok) {
    console.error("moderate-content openai", response.status, (await response.text()).slice(0, 800));
    return json({ allowed: true, flagged: false, categories: [], degraded: true });
  }
  const payload = await response.json();
  const result = payload?.results?.[0] || {};
  const categories = Object.entries(result?.categories || {}).filter(([, on]) => on === true).map(([name]) => name);
  const flagged = Boolean(result?.flagged);
  return json({ allowed: !flagged, flagged, categories });
});
