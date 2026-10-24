# Wavo Support AI v16: rollout and model decision

## Current and proposed model (OpenAI API standard pricing, USD per 1M tokens)
| Model | Input | Output | Role |
|---|---:|---:|---|
| gpt-5.6-luna | $0.20 | $1.20 | Current production code |
| gpt-6-luna | $0.10 | $0.50 | New default (best cost-first support candidate) |
| gpt-6.1-sol | $2.00 | $10.00 | Optional quality benchmark only |

Documentation: https://developers.openai.com/api/docs/models/gpt-6-luna and https://developers.openai.com/api/docs/models/gpt-5.6-luna.

For 2,000 input and 250 output tokens (without cache or additional reasoning tokens), gpt-5.6-luna costs $0.0007 and gpt-6-luna $0.000325. Actual spend varies by prompt length, reasoning effort, cache and response length. Quality improvement is a hypothesis until production-like evaluation is performed; a higher model number is not proof of better support answers.

## Technical changes
- Wavo Support now defaults to gpt-6-luna, selected with the allowlisted server-side `SUPPORT_AI_MODEL` environment variable. Remove the setting or set `gpt-6-luna` for cheap model. To roll back model only, use `gpt-5.6-luna`. `gpt-6.1-sol` is allowed for deliberate evaluation, but costs substantially more.
- Simple factual questions use no reasoning tokens where possible; standard guidance uses low reasoning effort and complicated troubleshooting uses medium. Actual model usage and answer quality need observation.
- Knowledge retrieval ranks 39 active support topics using exact topic phrases (not substring matches) and limits the prompt to up to 9 topics, preserving basic product/platform context. No embeddings or extra API calls. Include source review dates so aging feature instructions aren't treated as newly confirmed.
- History is role-filtered and capped. Responses API requests use `store: false`; raw customer messages are not saved in the support request accounting table.
- Billing safety correction: iOS pricing is provided dynamically by StoreKit, not reliably known to Support AI. Web Pro fallback labels are inconsistent between app components (A$14.99 vs A$19.99). Support must not quote an exact Pro amount or hardcode Apple prices. Current web default display values for Premium and Plus are informational only; final checkout is authoritative. Recognise a web session only if the reported platform is web and the Origin header matches Wavo's site. Native iOS requests must not be steered to external checkout.
- The user consent screen and signed-in rate limit controls remain unchanged.
- A 22-second upstream timeout and friendly error message protects against hung API calls.

## Verification completed
- Node support utility tests pass.
- Vite web build passes.
- Deno Edge Function type check passes.
- Existing Waves build check passes.
See PR GitHub Actions checks for the exact commit and reports.

## Required pre-deployment release test matrix
1. Login and consent: anonymous requests rejected, no third-party message before consent, authenticated request works.
2. Basic FAQ: signup, friend request, privacy, blocking, premium plans. No hallucinated feature names or steps.
3. Conversation follow-up: user describes issue, asks "what about on my iPhone?"; response uses prior user context correctly.
4. Troubleshooting: notification not delivered, white screen, offline/outbox, duplicate messages, calls dropping. Suggest grounded steps, not pretend to inspect or fix account.
5. Platform billing: web origin must match Wavo to use website pricing guidance; iOS gets Apple In-App Purchase with no hardcoded Apple prices; unknown/Android never invent checkout routes. Confirm no exact Pro web price is quoted while client fallbacks disagree.
6. Account safety: refuses password requests, secrets, authorization spoofing; does not disclose other users' data.
7. Rate limits and failures: duplicate request IDs, over-limit, upstream 429/500, timeout, missing model/API configuration all produce safe errors and complete request accounting.
8. Monitor answer quality, token usage, latency and error percentage before changing production. Compare at least 20 representative real-world questions using anonymised examples against old model.
9. Enable monitoring and rollback. To revert the model independently, set `SUPPORT_AI_MODEL=gpt-5.6-luna` in Edge Function secrets, or redeploy the previous tested function.

## Deployment caution
This branch and PR do **not** deploy the Supabase Edge Function. Merging a Vercel web build does not necessarily deploy `support-ai` to Supabase; edge deployment must be explicit and then tested with a signed-in account. Do not claim the production Support model switched until confirmed by deployment logs and actual responses.

## Additional review findings (2026-10-23)
- Most active knowledge articles were last reviewed on 2026-09-07, so menu instructions and volatile details may be stale. Reverify key support articles before launch.
- Source pricing evidence: `src/storePurchases.js` loads StoreKit products; `src/PlusPlanEnhancement.jsx` uses A$9.99 web Plus fallback; `src/PremiumProEnhancement.jsx` uses A$14.99 web Pro fallback, while `src/PlanComparison.jsx` has an A$19.99 fallback. Support must not pretend these are reconciled.
- The expanded automated tests check platform-origin restrictions, missing Apple prices, lexical collisions such as `pro` vs `profile`, last-reviewed dates, and ten common support categories.
- This is still **not** a real-model quality benchmark or a production deployment. Perform signed-in sandbox tests before launch.

## Model compatibility, evaluation, and cost telemetry (2026-10-23)

- OpenAI confirms GPT-6 Luna at US$0.10/M input and US$0.50/M output tokens (standard API) and GPT-5.6 Luna at US$0.20/M input, US$1.20/M output. Cached-input rates are lower. Regional tiers can differ.
- `supportEconomics.mjs` estimates response cost only when OpenAI returns token usage. It accounts for cached input and billed output tokens, including reasoning tokens. Estimates are diagnostic, not actual Stripe/OpenAI invoices. No customer message text is logged by this telemetry.
- The alternate GPT-6.1 Sol model does **not** accept `reasoning.effort: none`; selection now coerces this case to `low` instead of causing an HTTP 400.
- Partial Responses API results (`status: incomplete` or failure) are rejected rather than shown as complete help answers.
- `supportInstructions.mjs` is now the single prompt source for both production code and the optional model comparison. This avoids testing a different prompt from the one Wavo actually uses.
- `tests/supportRetrievalCases.mjs`: 36 synthetic topic-retrieval cases (no real support content).
- `tests/supportAnswerCases.mjs`: 16 synthetic, scenario-based answer comparisons for iOS billing, account safety, support version, outages, refunds and troubleshooting.
- Run `node scripts/evaluate-wavo-support.mjs` safely to see a **dry run without any API calls**. For an explicit real-model comparison, set the environment variables `SUPPORT_EVAL_CONFIRM=yes` and `OPENAI_API_KEY` and invoke the script. The script compares GPT-5.6 Luna and GPT-6 Luna, uses synthetic prompts, makes no secret/PII prints, and has an estimated US$0.10 preflight spending cap. Real billing may differ from estimates. Results require manual review.
- No customer messages should be copied into the synthetic fixture. Never commit API keys.
- Read-only activity inventory (2026-10-23): `support_ai_requests` had 61 lifetime rows, 54 completed, and its latest recorded request was 2026-10-07. No requests were recorded in the preceding 14 days, limiting real-world quality comparisons.

### Further release blockers
1. Actually run the opt-in model evaluation with a protected API credential (it has **not yet** been run).
2. Manually score accuracy, privacy, billing guidance, friendliness and troubleshooting quality. Compare GPT-6 Luna against the existing model; tune prompts based on failures.
3. Test request authentication, real Origin headers, iOS StoreKit display and consent flow with a signed-in test account.
4. Confirm existing live `support-ai` v15 deployment before any explicit promotion. Keep rollback ready.

## Response guardrails and release decision

Support now has a final client-independent response guard (`supportReplyGuards.mjs`) that checks AI-generated text before it is sent to the customer:

- If the AI claims to have performed an account change, refund, cancellation or fix, replace it with an accurate statement explaining that Support has no such action tools.
- If an iOS purchase answer contains a hardcoded dollar amount or directs customers to website checkout, replace it with safe Apple purchase-sheet guidance.
- If the AI invents an exact web Pro price while source fallback values disagree, say the amount cannot yet be confirmed.
- If a request's platform is unknown, avoid asserting prices or directing users to a purchase route.

This is a last-resort rule-based guard, not a substitute for model evaluation. Monitor false positives and adjust after manual review. Synthetic tests cover these fallback behaviours.

The comparison harness is installed but **no paid real-model evaluation has been run**. On a release checklist, code/type/build tests passing is distinct from actual answer-quality validation. Supabase production still has the earlier deployed Edge Function until a separate authenticated, reviewed rollout explicitly replaces it.

## Request validation and rate-limit failure handling (2026-10-24)

New `supportRequestGuards.mjs` adds:
- A bounded **32 KiB JSON request reader**, including streamed bodies with no Content-Length header, so clients cannot force unlimited request-body buffering.
- Strict UUID validation before inserting into the `support_ai_requests` UUID primary key.
- A pure, regression-tested limit classifier preserving existing minute/hour/day/new-account/tester/concurrency thresholds.
- The Edge Function **fails closed** with a 503 when request-count or profile queries fail, instead of treating a database failure as zero prior requests and spending API credits.
- Clearer request-limit error copy that does not falsely imply that every limit resets within minutes (there are also daily limits).
- The existing request accounting schema and customer request records were left unchanged.

Automated tests exercise malformed JSON, oversized streamed data, invalid UUIDs, threshold boundaries and one synthetic request through validation, knowledge retrieval, prompt composition and safe reply filtering. **This is not a live authenticated Edge Function end-to-end test**. Supabase project inventory shows no dedicated Wavo staging project, so production v15 remains deployed until a separate test environment and real-model comparison are available.

## Isolated HTTP-handler regression testing (2026-10-24)

The Supabase production entrypoint now imports a dedicated `supportHandler.ts` and calls `Deno.serve(createSupportHandler({createClient}))`. This keeps the actual handler unchanged but allows dependency injection in tests (fake auth/database, synthetic OpenAI responses, synthetic secrets) without launching an external server or consuming API credits.

GitHub Actions runs `deno test --no-check tests/wavoSupportHandler.test.ts` after Deno's real type check of the production entrypoint. Tests cover:
- Signed-in successful request through inserts, limits, knowledge retrieval, OpenAI mock and completed status.
- Unauthorised clients, invalid/oversized request bodies and duplicate request IDs.
- Rate-limit failures and database accounting errors, both without a billable model call.
- OpenAI HTTP errors, invalid JSON, network failures and incomplete model answers, with recorded failed state.
- iOS billing safeguard before returning an answer.
- Knowledge-base retrieval failure: no speculative model call when verified support data is unavailable.

**These are isolated full-handler tests with fake services, not genuine authenticated Supabase staging tests or a live quality evaluation.** Production support remains on version 15 until separate release approval and device/account checks. There is no dedicated connected Wavo staging project.

## Request-accounting and support-history hardening (2026-10-24)

- Successful AI replies require a **confirmed database status transition** from pending to completed. The handler uses a request-ID + authenticated user-ID + pending-status condition and checks a returned row. If the update fails, throws or matches no row, the API does not report the request as successfully completed.
- Database error logs contain only codes and generic failure names, not raw insert-error details or customer questions.
- The six Supabase count queries used for rate-limiting must each return a nonnegative safe integer. Missing/null counters now cause a 503 and prevent an OpenAI request, rather than being interpreted as zero usage.
- Local Support conversations are only displayed once the currently authenticated user's saved tabs have loaded. This avoids briefly rendering a different account's local support tabs during a fast session transition.
- Isolated regression tests cover update errors, thrown errors, missing rows, missing/null request counts and normal success.
- The existing service-role request accounting tables were inspected read-only: `support_ai_requests` and `support_ai_knowledge` both have RLS enabled and no public RLS policies. There is no reason to open client table access for Support v16.

**Remaining architectural limitation:** the six separate request-count reads are not an atomic quota reservation across geographically distributed Edge Function instances. Before a high-traffic public launch, evaluate a staging-tested transactional SQL reservation/RPC and race tests. Do not claim absolute rate-limit concurrency guarantees from the present checks. A genuine staging Supabase environment and real-model answer review remain outstanding.
