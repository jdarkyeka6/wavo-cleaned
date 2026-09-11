import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { isNative } from './lib/platform'

const UGC_FORM_SELECTOR = '.composer, .create-form, .waves-composer, .waves-reply'

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

  useEffect(() => {
    if (!isNative()) return undefined

    async function intercept(event) {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !form.matches(UGC_FORM_SELECTOR)) return

      if (bypass.current.has(form)) {
        bypass.current.delete(form)
        return
      }

      const text = formText(form)
      if (!text) return

      event.preventDefault()
      event.stopImmediatePropagation()

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
        window.alert("Wavo couldn't safety-check this content right now. Please try again in a moment.")
      }
    }

    document.addEventListener('submit', intercept, true)
    return () => document.removeEventListener('submit', intercept, true)
  }, [])

  return null
}
