import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { isNative } from './lib/platform'

const UGC_FORM_SELECTOR = '.composer, .create-form, .waves-composer, .waves-reply'
const NOTICE_ID = 'wavo-safety-unavailable'

// Preserve fail-closed moderation without trapping the user in modal alerts.
function showSafetyUnavailable() {
  let notice = document.getElementById(NOTICE_ID)
  if (!notice) {
    notice = document.createElement('div')
    notice.id = NOTICE_ID
    notice.setAttribute('role', 'status')
    notice.setAttribute('aria-live', 'polite')
    notice.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top, 0px));left:12px;right:12px;z-index:100000;max-width:540px;margin-inline:auto;background:#253044;border:1px solid #7585a4;border-radius:16px;padding:13px 16px;color:#fff;font:500 14px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px #0006;pointer-events:none'
    document.body.appendChild(notice)
  }
  notice.textContent = "Wavo couldn't check this message just now. It hasn't been sent. Please try again shortly."
  clearTimeout(notice._wavoDismissTimer)
  notice._wavoDismissTimer = setTimeout(() => notice.remove(), 4500)
}


async function moderateText(text) {
  const { data, error } = await supabase.functions.invoke('moderate-content', {
    body: { text },
  })
  if (error) throw error
  return data || { allowed: false }
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

      if (bypass.current.has(form)) {
        bypass.current.delete(form)
        return
      }

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
        const result = await moderateText(text)
        if (result?.allowed === false) {
          window.alert('Wavo blocked this because it may contain objectionable or unsafe content.')
          return
        }

        bypass.current.add(form)
        form.requestSubmit(event.submitter instanceof HTMLElement ? event.submitter : undefined)
      } catch (error) {
        console.error('[wavo] native moderation unavailable', error)
        showSafetyUnavailable()
      } finally {
        pending.current.delete(form)
      }
    }

    document.addEventListener('submit', intercept, true)
    return () => document.removeEventListener('submit', intercept, true)
  }, [])

  return null
}
