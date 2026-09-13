export const AI_CONSENT_KEY = 'wavo-third-party-ai-consent:v1'

export function hasThirdPartyAiConsent() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AI_CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

export function grantThirdPartyAiConsent() {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(AI_CONSENT_KEY, 'yes')
    return true
  } catch {
    return false
  }
}

export function revokeThirdPartyAiConsent() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(AI_CONSENT_KEY) } catch { /* ignore storage failures */ }
}

export function ensureThirdPartyAiConsent() {
  if (hasThirdPartyAiConsent()) return true
  if (typeof window === 'undefined') return false
  const accepted = window.confirm(
    'Wavo AI uses OpenAI to process the content you choose to send to an AI feature and generate a result. Do not include passwords, payment details, addresses, phone numbers, or other sensitive information. Continue?',
  )
  if (accepted) grantThirdPartyAiConsent()
  return accepted
}
