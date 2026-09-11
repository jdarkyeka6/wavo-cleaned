import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * App Store release hardening.
 *
 * Build 38 intentionally ships one finalized Wavo AppIcon. The web Premium
 * studio can still expose cosmetic icon choices, but those alternate icon
 * assets are not bundled in the App Store build. Hide that unavailable control
 * on native iOS so reviewers/users can never trigger a dead feature.
 */
export default function NativeReviewHardening() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return

    const sync = () => {
      document.querySelectorAll('.wpp-control-grid label').forEach((label) => {
        const text = label.textContent?.trim().toLowerCase() || ''
        if (text.startsWith('app icon')) {
          label.hidden = true
          label.setAttribute('aria-hidden', 'true')
        }
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
