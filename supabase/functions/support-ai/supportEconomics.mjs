// Known standard API text prices in USD per 1,000,000 tokens.
// Verified against https://developers.openai.com/api/docs/pricing on 2026-10-23.
// Update prices deliberately as part of reviewed dependency/config releases.
export const SUPPORT_MODEL_PRICES = Object.freeze({
  "gpt-6-luna": Object.freeze({ input: 0.10, cachedInput: 0.01, output: 0.50 }),
  "gpt-5.6-luna": Object.freeze({ input: 0.20, cachedInput: 0.02, output: 1.20 }),
  "gpt-6.1-sol": Object.freeze({ input: 2.00, cachedInput: 0.10, output: 10.00 }),
});

// GPT-6.1 Sol does not support effort=none. Avoid an API HTTP 400
// if administrators temporarily select the expensive evaluation model.
export function resolveCompatibleReasoning(model, effort) {
  const requested = ["none", "low", "medium", "high"].includes(effort) ? effort : "medium";
  return model === "gpt-6.1-sol" && requested === "none" ? "low" : requested;
}

export function supportMaxOutputTokens(effort) {
  return effort === "medium" || effort === "high" ? 1300
    : effort === "low" ? 800 : 450;
}

function validCount(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

// Estimate *only* when token-usage telemetry is present, using the requested
// known model. Output token counts include billed reasoning tokens.
// This is an estimate, not an invoice (tiers/region/caching may vary).
export function estimateSupportCostUsd(model, usage) {
  const rate = SUPPORT_MODEL_PRICES[model];
  if (!rate) return null;
  const input = validCount(usage?.input_tokens);
  const output = validCount(usage?.output_tokens);
  if (input === null || output === null) return null;
  const cachedRaw = validCount(usage?.input_tokens_details?.cached_tokens);
  const cached = cachedRaw === null ? 0 : Math.min(input, cachedRaw);
  const usd = ((input - cached) * rate.input + cached * rate.cachedInput + output * rate.output) / 1_000_000;
  return Number(usd.toFixed(8));
}

export function isSupportResponseComplete(data) {
  return !!data && typeof data === "object" && (
    data.status === "completed" || (!("status" in data) && !("incomplete_details" in data))
  );
}
