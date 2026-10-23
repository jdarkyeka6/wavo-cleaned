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
