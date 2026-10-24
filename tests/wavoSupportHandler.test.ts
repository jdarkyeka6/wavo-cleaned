import assert from "node:assert/strict";
import { createSupportHandler } from "../supabase/functions/support-ai/supportHandler.ts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function setup({
  authenticated = true,
  insertError = null,
  counts = [1, 1, 1, 1, 1, 1],
  failedCount = -1,
  profileError = null,
  kbError = null,
  openAiStatus = 200,
  openAiBody = { status: "completed", model: "gpt-6-luna", output_text: "Check notification permissions in iPhone Settings.", usage: { input_tokens: 200, output_tokens: 30 } },
  throwOpenAi = false,
} = {}) {
  const actions = { inserts: [], updates: [], upstream: [], logs: [] };
  let countIndex = 0;
  const client = {
    auth: {
      getUser: async (token: string) => authenticated && token === "good-token"
        ? { data: { user: { id: USER_ID } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } },
    },
    from(table: string) {
      return {
        insert: async (value: unknown) => {
          actions.inserts.push({ table, value });
          return { error: insertError };
        },
        update: (value: unknown) => ({
          eq: async (_column: string, _id: string) => {
            actions.updates.push({ table, value });
            return { error: null };
          },
        }),
        select: (_columns: string, options: { count?: string } = {}) => {
          const selectedCount = options.count === "exact" ? countIndex++ : -1;
          return {
            eq(_column: string, _value: unknown) { return this; },
            gte(_column: string, _value: string) { return this; },
            order(_column: string) {
              return Promise.resolve({
                data: [
                  { topic: "product", content: "Wavo is a social app.", verified_at: "2026-10-01" },
                  { topic: "ios_push", content: "Check iPhone notifications permissions.", verified_at: "2026-10-01" },
                  { topic: "premium", content: "iOS pricing comes from the App Store purchase sheet.", verified_at: "2026-10-01" },
                ],
                error: kbError,
              });
            },
            maybeSingle() {
              return Promise.resolve({
                data: { created_at: "2026-09-01T00:00:00Z", username: "tester", is_admin: false, support_unlimited: false },
                error: profileError,
              });
            },
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
              return Promise.resolve({
                count: counts[selectedCount] ?? 1,
                error: selectedCount === failedCount ? { code: "PGRST500" } : null,
              }).then(resolve, reject);
            },
          };
        },
      };
    },
  };
  const env: Record<string,string> = {
    SUPABASE_URL: "https://mock.supabase.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret-only",
    OPENAI_API_KEY: "synthetic-openai-key-only",
  };
  const handler = createSupportHandler({
    createClient: () => client,
    getEnv: (key: string) => env[key],
    logger: { info: (...args: unknown[]) => actions.logs.push({ level: "info", args }), error: (...args: unknown[]) => actions.logs.push({ level: "error", args }) },
    openAiFetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      actions.upstream.push({ url: String(url), input: JSON.parse(String(init?.body || "{}")) });
      if (throwOpenAi) throw new Error("synthetic connection failure");
      if (openAiBody === "invalid-json") return new Response("NOT JSON", { status: openAiStatus });
      return new Response(JSON.stringify(openAiBody), { status: openAiStatus, headers: { "content-type": "application/json" } });
    },
  });
  return { handler, actions };
}

function request(body: unknown = {
  requestId: REQUEST_ID,
  question: "My iPhone notifications do not work.",
  history: [{ role: "user", content: "I am on iPhone" }],
  platform: "ios",
}, token = "good-token") {
  return new Request("https://mock.supabase.invalid/functions/v1/support-ai", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function reply(response: Response) {
  return { status: response.status, body: await response.json() };
}

Deno.test("end-to-end happy path authenticates, accounts, retrieves KB and returns model answer", async () => {
  const { handler, actions } = setup();
  const result = await reply(await handler(request()));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.reply.includes("notification"));
  assert.equal(actions.inserts.length, 1);
  assert.equal(actions.updates[0].value.status, "completed");
  assert.equal(actions.upstream.length, 1);
  assert.equal(actions.upstream[0].input.model, "gpt-6-luna");
  assert.equal(actions.upstream[0].input.store, false);
  assert.equal(actions.upstream[0].input.reasoning.effort, "low");
  assert.ok(!JSON.stringify(actions.logs).includes("My iPhone notifications"));
});

Deno.test("unknown or missing authentication cannot consume a paid model request", async () => {
  const { handler, actions } = setup({ authenticated: false });
  assert.equal((await handler(request())).status, 401);
  assert.equal(actions.inserts.length, 0);
  assert.equal(actions.upstream.length, 0);
  const missing = new Request("https://mock.supabase.invalid", { method: "POST", body: "{}" });
  assert.equal((await handler(missing)).status, 401);
});

Deno.test("invalid and oversized bodies are rejected before accounting", async () => {
  const { handler, actions } = setup();
  const malformed = request({ requestId: "bad-id", question: "Hi" });
  assert.equal((await handler(malformed)).status, 400);
  const huge = request({ requestId: REQUEST_ID, question: "x".repeat(40000) });
  assert.equal((await handler(huge)).status, 413);
  assert.equal(actions.inserts.length, 0);
  assert.equal(actions.upstream.length, 0);
});

Deno.test("duplicate id is rejected without a second billable call", async () => {
  const { handler, actions } = setup({ insertError: { code: "23505" } });
  const output = await reply(await handler(request()));
  assert.equal(output.status, 409);
  assert.equal(output.body.error, "duplicate_request");
  assert.equal(actions.upstream.length, 0);
});

Deno.test("rate limits fail closed on unavailable counting queries", async () => {
  const { handler, actions } = setup({ failedCount: 0 });
  const output = await reply(await handler(request()));
  assert.equal(output.status, 503);
  assert.equal(output.body.error, "support_unavailable");
  assert.equal(actions.updates[0].value.error_code, "accounting_unavailable");
  assert.equal(actions.upstream.length, 0);
});

Deno.test("exceeding account request limits is recorded and avoids paid calls", async () => {
  const { handler, actions } = setup({ counts: [7, 1, 1, 1, 1, 1] });
  const output = await reply(await handler(request()));
  assert.equal(output.status, 429);
  assert.equal(actions.updates[0].value.status, "blocked_rate_limit");
  assert.equal(actions.upstream.length, 0);
});

Deno.test("upstream failures and malformed response JSON finish accounting", async () => {
  for (const config of [
    { openAiStatus: 429 },
    { openAiBody: "invalid-json" },
    { throwOpenAi: true },
    { openAiBody: { status: "incomplete", output_text: "unfinished" } },
  ]) {
    const { handler, actions } = setup(config);
    const output = await reply(await handler(request()));
    assert.equal(output.status, 502);
    assert.equal(actions.updates[0].value.status, "failed");
    assert.equal(actions.upstream.length, 1);
  }
});

Deno.test("unsupported refund claims and unverified iOS prices are corrected before returning", async () => {
  const { handler, actions } = setup({
    openAiBody: { status: "completed", model: "gpt-6-luna", output_text: "Wavo Pro costs A$17.95 and you should use the website.", usage: { input_tokens: 300, output_tokens: 90 } },
  });
  const output = await reply(await handler(request({ requestId: REQUEST_ID, question: "How much is Wavo Pro on my iPhone?", platform: "ios" })));
  assert.equal(output.status, 200);
  assert.ok(output.body.reply.includes("Apple App Store purchase sheet"));
  assert.ok(!output.body.reply.includes("17.95"));
  assert.equal(actions.updates[0].value.status, "completed");
});
