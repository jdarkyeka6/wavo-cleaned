// Optional features may ship before their backend migration.
// Cache only missing-object errors; never hide RLS, auth or network failures.
const MISSING_OBJECT_CODES = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export function isMissingOptionalBackendObject(error) {
  return MISSING_OBJECT_CODES.has(String(error?.code || ''))
}

export function createOptionalBackendGate(retryMs = 5 * 60 * 1000) {
  const unavailableUntil = new Map()
  return {
    unavailable(feature, now = Date.now()) {
      return (unavailableUntil.get(feature) || 0) > now
    },
    markMissing(feature, error, now = Date.now()) {
      if (!isMissingOptionalBackendObject(error)) return false
      unavailableUntil.set(feature, now + retryMs)
      return true
    },
  }
}

export const optionalBackend = createOptionalBackendGate()
