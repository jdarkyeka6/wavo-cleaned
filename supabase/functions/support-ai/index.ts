import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { extractSupportResponseText, resolveSupportModel, sanitizeSupportHistory, selectRelevantKnowledge, supportInput, supportReasoningEffort } from "./supportUtils.mjs";
import { billingGuidance, resolveSupportPlatform } from "./supportBilling.mjs";
import { estimateSupportCostUsd, isSupportResponseComplete, resolveCompatibleReasoning, supportMaxOutputTokens } from "./supportEconomics.mjs";
import { buildSupportInstructions } from "./supportInstructions.mjs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });
const getSecretKey = () => {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) { try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default; const first = Object.values(parsed)[0]; if (typeof first === "string") return first; } catch {} }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
};
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
async function sha256(value: string) { const bytes = new TextEncoder().encode(value.trim().toLowerCase().replace(/\s+/g, " ")); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function plainText(value: string): string { return value.replace(/\*\*/g, "").replace(/__/g, "").replace(/`/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^[-*]\s+/gm, "").trim(); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""; const serviceKey = getSecretKey(); const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim(); if (!token) return json({ error: "unauthorized" }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }); const { data: authData, error: authError } = await admin.auth.getUser(token); const user = authData?.user; if (authError || !user) return json({ error: "unauthorized" }, 401);
  let body: any; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const requestId = String(body?.requestId || ""); const question = String(body?.question || "").trim(); const history = sanitizeSupportHistory(body?.history);
  const requestedPlatform = String(body?.platform || "unknown").toLowerCase();
  const platform = resolveSupportPlatform(requestedPlatform, req.headers.get("origin"));
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "bad_request_id" }, 400); if (!question) return json({ error: "empty_question" }, 400); if (question.length > 2000) return json({ error: "input_too_long", message: "Keep each support message under 2,000 characters." }, 400);
  const questionHash = await sha256(question); const { error: claimError } = await admin.from("support_ai_requests").insert({ request_id: requestId, user_id: user.id, question_hash: questionHash, status: "pending", input_chars: question.length });
  if (claimError) { if (claimError.code === "23505") return json({ error: "duplicate_request" }, 409); console.error("support-ai claim", claimError); return json({ error: "claim_failed" }, 500); }
  const finish = async (status: string, patch: Record<string, unknown> = {}) => { await admin.from("support_ai_requests").update({ status, completed_at: new Date().toISOString(), ...patch }).eq("request_id", requestId); };
  const [{ count: minuteCount }, { count: hourCount }, { count: dayCount }, { count: globalDayCount }, { count: sameQuestionCount }, { count: pendingCount }, { data: profile }] = await Promise.all([
    admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(24 * 60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).gte("created_at", agoIso(24 * 60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).eq("question_hash", questionHash).gte("created_at", agoIso(10 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending").gte( "created_at", agoIso(2 * 60_000)), admin.from("profiles").select("created_at,username,is_admin,support_unlimited").eq("id", user.id).maybeSingle(),
  ]);
  const accountAgeMs = profile?.created_at ? Date.now() - new Date(profile.created_at).getTime() : Number.POSITIVE_INFINITY; const newAccount = accountAgeMs < 24 * 60 * 60_000; const trustedTester = profile?.support_unlimited === true; const personalLimitHit = trustedTester ? ((minuteCount || 0) > 60 || (hourCount || 0) > 500 || (dayCount || 0) > 2000) : ((minuteCount || 0) > 6 || (hourCount || 0) > 20 || (dayCount || 0) > (newAccount ? 10 : 60) || (sameQuestionCount || 0) >= 6); const blocked = personalLimitHit || (globalDayCount || 0) > 2000 || (pendingCount || 0) > 2;
  if (blocked) { await finish("blocked_rate_limit", { error_code: (sameQuestionCount || 0) >= 6 ? "duplicate_spam" : "rate_limit" }); return json({ error: "rate_limit", message: "You're sending support requests pretty quickly. Give it a few minutes, then try again." }, 429); }
  if (!openAiKey) { await finish("failed", { error_code: "openai_key_missing" }); return json({ error: "openai_key_missing" }, 503); }
  // Retrieval is deterministic and deliberately limited. The entire KB is no
  // longer inserted into every prompt, reducing irrelevant context and spend.
  const { data: knowledge, error: kbError } = await admin.from("support_ai_knowledge")
    .select("topic,content,verified_at").eq("active", true).order("topic");
  if (kbError) console.error("support-ai knowledge load failed", kbError.code);
  const selectedKnowledge = selectRelevantKnowledge(knowledge || [], question, history, 9);
  const kb = selectedKnowledge.map((k) => `- ${k.topic} (last reviewed ${k.verified_at ? String(k.verified_at).slice(0,10) : "unknown"}): ${k.content}`).join("\n");
  const supportVersion = "v16";
  const accountContext = profile?.is_admin
    ? `AUTHENTICATED ACCOUNT: ${profile?.username || "signed-in user"}; verified Wavo admin.`
    : `AUTHENTICATED ACCOUNT: ${profile?.username || "signed-in user"}; no admin flag.`;
  const billingRule = billingGuidance(platform);
  const instructions = buildSupportInstructions({ supportVersion, platform, accountContext, billingRule, kb });
  const model = resolveSupportModel(Deno.env.get("SUPPORT_AI_MODEL"));
  const reasoningEffort = resolveCompatibleReasoning(model, supportReasoningEffort(question));
  // Reasoning tokens count towards max_output_tokens; provide room for
  // diagnosis without turning routine requests into long expensive replies.
  const maxOutputTokens = supportMaxOutputTokens(reasoningEffort);
  let openAiResponse: Response;
  try {
    openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${openAiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: reasoningEffort },
        instructions,
        input: supportInput(question, history),
        max_output_tokens: maxOutputTokens,
      }),
      signal: AbortSignal.timeout(22_000),
    });
  } catch (error) {
    console.error("support-ai upstream request error", error instanceof Error ? error.name : "unknown");
    await finish("failed", { error_code: "upstream_unavailable" });
    return json({ error: "ai_failed", message: "AI support couldn't connect right now. Please try again." }, 502);
  }
  if (!openAiResponse.ok) { const detail = await openAiResponse.text(); console.error("support-ai upstream status", openAiResponse.status, detail.length); await finish("failed", { error_code: `openai_${openAiResponse.status}` }); return json({ error: "ai_failed", message: "AI support couldn't answer right now. Try again in a moment." }, 502); }
  let result: any;
  try {
    result = await openAiResponse.json();
  } catch {
    await finish("failed", { error_code: "invalid_upstream_json" });
    return json({ error: "ai_failed", message: "AI support returned an unreadable reply. Please try again." }, 502);
  }
  if (!isSupportResponseComplete(result)) {
    await finish("failed", { error_code: "upstream_incomplete" });
    return json({ error: "ai_failed", message: "AI support couldn't finish that reply. Please try a shorter question." }, 502);
  }
  const reply = plainText(extractSupportResponseText(result)).slice(0, 2400);
  if (!reply) {
    await finish("failed", { error_code: "empty_response" });
    return json({ error: "empty_response", message: "AI support couldn't complete that answer. Please try again." }, 502);
  }
  // Aggregate token counts only, without logging customer questions or message text.
  console.info("support-ai usage", JSON.stringify({
    model: result?.model || model,
    input_tokens: Number(result?.usage?.input_tokens || 0),
    output_tokens: Number(result?.usage?.output_tokens || 0),
    estimated_usd: estimateSupportCostUsd(model, result?.usage),
  }));
  await finish("completed", { model: result?.model || model, output_tokens: Number(result?.usage?.output_tokens || 0) }); return json({ ok: true, reply });
});