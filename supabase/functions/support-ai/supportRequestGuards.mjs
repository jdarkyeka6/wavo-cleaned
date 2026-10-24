// Dependency-free request guards for Wavo Support's public Edge Function.
// Supports native Request in Deno and Node tests. Does not handle user auth.
export const MAX_SUPPORT_BODY_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSupportRequestId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function readSupportBody(req, maxBytes = MAX_SUPPORT_BODY_BYTES) {
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    return { ok: false, status: 413, code: "request_too_large", message: "Keep support requests under 32 KB." };
  }
  if (!req.body) return { ok: false, status: 400, code: "bad_json" };
  let chunks = [], size = 0;
  const reader = req.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Cancel without waiting for an untrusted client to finish streaming.
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413, code: "request_too_large", message: "Keep support requests under 32 KB." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "bad_json" };
  } finally {
    reader.releaseLock();
  }
  try {
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, status: 400, code: "bad_json" };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400, code: "bad_json" };
  }
}

function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

export function classifySupportRateLimit(counters, { trustedTester = false, newAccount = false } = {}) {
  const minute = count(counters.minuteCount), hour = count(counters.hourCount);
  const day = count(counters.dayCount), global = count(counters.globalDayCount);
  const repeat = count(counters.sameQuestionCount), pending = count(counters.pendingCount);
  // The newly claimed request is already in these counts.
  const personal = trustedTester
    ? minute > 60 || hour > 500 || day > 2000
    : minute > 6 || hour > 20 || day > (newAccount ? 10 : 60) || repeat >= 6;
  const blocked = personal || global > 2000 || pending > 2;
  return { blocked, errorCode: blocked ? (repeat >= 6 ? "duplicate_spam" : "rate_limit") : null };
}
