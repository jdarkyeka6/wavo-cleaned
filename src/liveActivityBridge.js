import { registerPlugin } from '@capacitor/core'
import { isIOS, isNativeApp } from './lib/platform'

const WavoLiveActivity = registerPlugin('WavoLiveActivity')

export function liveActivitiesSupported() {
  return isNativeApp && isIOS()
}

export async function getLiveActivityState() {
  if (!liveActivitiesSupported()) return { supported: false, enabled: false, activities: [] }
  try {
    return await WavoLiveActivity.getState()
  } catch (err) {
    console.info('[wavo live activity] native bridge unavailable', err?.message || err)
    return { supported: false, enabled: false, activities: [] }
  }
}

export async function startLiveActivity(payload) {
  if (!liveActivitiesSupported()) return null
  return WavoLiveActivity.start(payload)
}

export async function updateLiveActivity(payload) {
  if (!liveActivitiesSupported() || !payload?.id) return
  return WavoLiveActivity.update(payload)
}

export async function endLiveActivity(id = null) {
  if (!liveActivitiesSupported()) return
  return WavoLiveActivity.end(id ? { id } : {})
}
