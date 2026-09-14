import { supabase } from './supabaseClient'

const PATCH_KEY = '__WAVO_AUTH_BOOT_RESILIENCE__'
const AUTH_BOOT_TIMEOUT_MS = 4000

function storedSessionFallback() {
  try {
    const host = new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname
    const projectRef = host.split('.')[0]
    if (!projectRef) return null

    const raw = window.localStorage.getItem(`sb-${projectRef}-auth-token`)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const session = parsed?.currentSession || parsed?.session || parsed
    if (!session?.access_token || !session?.user?.id) return null
    return session
  } catch {
    return null
  }
}

export function installAuthBootResilience() {
  if (typeof window === 'undefined' || window[PATCH_KEY]) return
  window[PATCH_KEY] = true

  const originalGetSession = supabase.auth.getSession.bind(supabase.auth)

  supabase.auth.getSession = async (...args) => {
    let timer
    const timeout = new Promise((resolve) => {
      timer = window.setTimeout(() => resolve({ timedOut: true }), AUTH_BOOT_TIMEOUT_MS)
    })

    try {
      const result = await Promise.race([
        originalGetSession(...args).then((value) => ({ value })),
        timeout,
      ])

      if (!result?.timedOut) return result.value

      console.warn('[wavo] auth session lookup timed out; using local boot fallback')
      return { data: { session: storedSessionFallback() }, error: null }
    } catch (error) {
      console.warn('[wavo] auth session lookup failed during boot', error)
      return { data: { session: storedSessionFallback() }, error: null }
    } finally {
      if (timer) window.clearTimeout(timer)
    }
  }
}
