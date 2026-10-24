import { extractSupportResponseText, resolveSupportModel, sanitizeSupportHistory, selectRelevantKnowledge, supportInput, supportReasoningEffort } from "./supportUtils.mjs";
import { billingGuidance, resolveSupportPlatform } from "./supportBilling.mjs";
import { estimateSupportCostUsd, isSupportResponseComplete, resolveCompatibleReasoning, supportMaxOutputTokens } from "./supportEconomics.mjs";
import { buildSupportInstructions } from "./supportInstructions.mjs";
import { guardSupportReply } from "./supportReplyGuards.mjs";
import { classifySupportRateLimit, isValidSupportRequestId, readSupportBody } from "./supportRequestGuards.mjs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });
const getSecretKey = (getEnv: (key: string) => string | undefined) => {
  const modern = getEnv("SUPABASE_SECRET_KEYS");
  if (modern) { try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default; const first = Object.values(parsed)[0]; if (typeof first === "string") return first; } catch {} }
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
};
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
async function sha256(value: string) { const bytes = new TextEncoder().encode(value.trim().toLowerCase().replace(/\s+/g, " ")); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function plainText(value: string): string { return value.replace(/\*\*/g, "").replace(/__/g, "").replace(/`/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^[-*]\s+/gm, "").trim(); }

type SupportDependencies = {
  createClient: (url: string, key: string, options?: any) => any;
  getEnv?: (key: string) => string | undefined;
  openAiFetch?: typeof fetch;
  logger?: Pick<Console, "info" | "error">;
};

// This is the same handler used by production, with injectable boundaries
// for isolated tests. No fake network responses or test hooks are shipped
// unless a caller explicitly supplies them.
export function createSupportHandler({
  createClient,
  getEnv = (key) => Deno.env.get(key),
  openAiFetch = fetch,
  logger = console,
}: SupportDependencies) {
  return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabaseUrl = getEnv("SUPABASE_URL") || ""; const serviceKey = getSecretKey(getEnv); const openAiKey = getEnv("OPENAI_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim(); if (!token) return json({ error: "unauthorized" }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }); const { data: authData, error: authError } = await admin.auth.getUser(token); const user = authData?.user; if (authError || !user) return json({ error: "unauthorized" }, 401);
  const parsed = await readSupportBody(req);
  if (!parsed.ok) {
    return json({ error: parsed.code, ...(parsed.message ? { message: parsed.message } : {}) }, parsed.status);
  }
  const body: any = parsed.data;
  const requestId = String(body?.requestId || ""); const question = String(body?.question || "").trim(); const history = sanitizeSupportHistory(body?.history);
  const requestedPlatform = String(body?.platform || "unknown").toLowerCase();
  const platform = resolveSupportPlatform(requestedPlatform, req.headers.get("origin"));
  if (!isValidSupportRequestId(requestId)) return json({ error: "bad_request_id" }, 400); if (!question) return json({ error: "empty_question" }, 400); if (question.length > 2000) return json({ error: "input_too_long", message: "Keep each support message under 2,000 characters." }, 400);
  const questionHash = await sha256(question); const { error: claimError } = await admin.from("support_ai_requests").insert({ request_id: requestId, user_id: user.id, question_hash: questionHash, status: "pending", input_chars: question.length });
  if (claimError) { if (claimError.code === "23505") return json({ error: "duplicate_request" }, 409); logger.error("support-ai claim", claimError); return json({ error: "claim_failed" }, 500); }
  const finish = async (status: string, patch: Record<string, unknown> = {}) => { await admin.from("support_ai_requests").update({ status, completed_at: new Date().toISOString(), ...patch }).eq("request_id", requestId); };
  const [{ count: minuteCount, error: minuteError }, { count: hourCount, error: hourError }, { count: dayCount, error: dayError }, { count: globalDayCount, error: globalDayError }, { count: sameQuestionCount, error: repeatError }, { count: pendingCount, error: pendingError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", agoIso(24 * 60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).gte("created_at", agoIso(24 * 60 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).eq("question_hash", questionHash).gte("created_at", agoIso(10 * 60_000)), admin.from("support_ai_requests").select("request_id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending").gte( "created_at", agoIso(2 * 60_000)), admin.from("profiles").select("created_at,username,is_admin,support_unlimited").eq("id", user.id).maybeSingle(),
  ]);
  if (minuteError || hourError || dayError || globalDayError || repeatError || pendingError || profileError) {
    // Failing open would permit unlimited requests if accounting breaks.
    logger.error("support-ai accounting query failed");
    await finish("failed", { error_code: "accounting_unavailable" });
    return json({
      error: "support_unavailable",
      message: "Wavo Support is having trouble checking request limits. Please try again shortly.",
    }, 503);
  }
  const accountAgeMs = profile?.created_at
    ? Date.now() - new Date(profile.created_at).getTime()
    : Number.POSITIVE_INFINITY;
  const newAccount = accountAgeMs < 24 * 60 * 60_000;
  const trustedTester = profile?.support_unlimited === true;
  const limits = classifySupportRateLimit(
    { minuteCount, hourCount, dayCount, globalDayCount, sameQuestionCount, pendingCount },
    { trustedTester, newAccount },
  );
  if (limits.blocked) {
    await finish("blocked_rate_limit", { error_code: limits.errorCode });
    return json({
      error: "rate_limit",
      message: "You've reached a Wavo Support request limit. Please try again later. Some limits reset over 24 hours.",
    }, 429);
  }
  if (!openAiKey) { await finish("failed", { error_code: "openai_key_missing" }); return json({ error: "openai_key_missing" }, 503); }
  // Retrieval is deterministic and deliberately limited. The entire KB is no
  // longer inserted into every prompt, reducing irrelevant context and spend.
  const { data: knowledge, error: kbError } = await admin.from("support_ai_knowledge")
    .select("topic,content,verified_at").eq("active", true).order("topic");
  if (kbError) {
    // Avoid spending API credits generating an answer with no verified Wavo
    // knowledge after a DB failure. No user content is written to logs.
    logger.error("support-ai knowledge load failed", kbError.code);
    await finish("failed", { error_code: "knowledge_unavailable" });
    return json({
      error: "support_unavailable",
      message: "Wavo Support couldn't load its help information. Please try again shortly.",
    }, 503);
  }
  const selectedKnowledge = selectRelevantKnowledge(knowledge || [], question, history, 9);
  const kb = selectedKnowledge.map((k) => `- ${k.topic} (last reviewed ${k.verified_at ? String(k.verified_at).slice(0,10) : "unknown"}): ${k.content}`).join("\n");
  const supportVersion = "v16";
  const accountContext = profile?.is_admin
    ? `AUTHENTICATED ACCOUNT: ${profile?.username || "signed-in user"}; verified Wavo admin.`
    : `AUTHENTICATED ACCOUNT: ${profile?.username || "signed-in user"}; no admin flag.`;
  const billingRule = billingGuidance(platform);
  const instructions = buildSupportInstructions({ supportVersion, platform, accountContext, billingRule, kb });
  const model = resolveSupportModel(getEnv("SUPPORT_AI_MODEL"));
  const reasoningEffort = resolveCompatibleReasoning(model, supportReasoningEffort(question));
  // Reasoning tokens count towards max_output_tokens; provide room for
  // diagnosis without turning routine requests into long expensive replies.
  const maxOutputTokens = supportMaxOutputTokens(reasoningEffort);
  let openAiResponse: Response;
  try {
    openAiResponse = await openAiFetch("https://api.openai.com/v1/responses", {
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
    logger.error("support-ai upstream request error", error instanceof Error ? error.name : "unknown");
    await finish("failed", { error_code: "upstream_unavailable" });
    return json({ error: "ai_failed", message: "AI support couldn't connect right now. Please try again." }, 502);
  }
  if (!openAiResponse.ok) { const detail = await openAiResponse.text(); logger.error("support-ai upstream status", openAiResponse.status, detail.length); await finish("failed", { error_code: `openai_${openAiResponse.status}` }); return json({ error: "ai_failed", message: "AI support couldn't answer right now. Try again in a moment." }, 502); }
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
  const reply = guardSupportReply(plainText(extractSupportResponseText(result)).slice(0, 2400), platform, question);
  if (!reply) {
    await finish("failed", { error_code: "empty_response" });
    return json({ error: "empty_response", message: "AI support couldn't complete that answer. Please try again." }, 502);
  }
  // Aggregate token counts only, without logging customer questions or message text.
  logger.info("support-ai usage", JSON.stringify({
    model: result?.model || model,
    input_tokens: Number(result?.usage?.input_tokens || 0),
    output_tokens: Number(result?.usage?.output_tokens || 0),
    estimated_usd: estimateSupportCostUsd(model, result?.usage),
  }));
  await finish("completed", { model: result?.model || model, output_tokens: Number(result?.usage?.output_tokens || 0) }); return json({ ok: true, reply });
  };
}
