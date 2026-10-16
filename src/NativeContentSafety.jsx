import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { isNative } from './lib/platform'

// Normal chat messages have one centralized moderation gate in App.jsx.
// Native intercepts are only needed for the other user-generated content forms.
const UGC_FORM_SELECTOR = '.create-form, .waves-composer, .waves-reply'
const NOTICE_ID = 'wavo-native-safety-notice'

function showNotice(message) {
  let notice = document.getElementById(NOTICE_ID)
  if (!notice) {
    notice = document.createElement('div')
    notice.id = NOTICE_ID
    notice.setAttribute('role', 'status')
    notice.setAttribute('aria-live', 'polite')
    notice.style.cssText = 'position:fixed;top:calc(14px + env(safe-area-inset-top, 0px));left:12px;right:12px;max-width:520px;margin:auto;z-index:99999;padding:13px 16px;border-radius:14px;border:1px solid #7487af;background:#24324a;color:#fff;font:500 14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 14px 34px #0007;pointer-events:none'
    document.body.appendChild(notice)
  }
  notice.textContent = message
  clearTimeout(notice._dismiss)
  notice._dismiss = setTimeout(() => notice.remove(), 4200)
}

async function moderateText(text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('moderate-content', { body: { text } })
    if (!error) {
      if (typeof data?.allowed !== 'boolean' || data.degraded) throw new Error('Invalid moderation response')
      return data.allowed
    }
    if (attempt === 0 && error?.context?.status === 401) {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (!refreshError) continue
    }
    throw error
  }
  throw new Error('Moderation unavailable')
}

function formText(form) {
  return [...form.querySelectorAll('textarea, input[type="text"], input:not([type])')]
    .filter((node) => !node.disabled && node.type !== 'hidden')
    .map((node) => String(node.value || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000)
}

export default function NativeContentSafety() {
  const bypass = useRef(new WeakSet())
  const pending = useRef(new WeakSet())
  useEffect(() => {
    if (!isNative()) return undefined
    async function intercept(event) {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.matches(UGC_FORM_SELECTOR)) return
      if (bypass.current.has(form)) { bypass.current.delete(form); return }
      if (pending.current.has(form)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      const text = formText(form)
      if (!text) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pending.current.add(form)
      try {
        if (!await moderateText(text)) {
          showNotice('Wavo blocked this content because it violates safety rules.')
          return
        }
        bypass.current.add(form)
        form.requestSubmit(event.submitter instanceof HTMLElement ? event.submitter : undefined)
      } catch (error) {
        console.warn('[wavo] native safety unavailable', error)
        showNotice("Wavo couldn't check this content. It has not been sent.")
      } finally {
        pending.current.delete(form)
      }
    }
    document.addEventListener('submit', intercept, true)
    return () => document.removeEventListener('submit', intercept, true)
  }, [])
  return null
}
