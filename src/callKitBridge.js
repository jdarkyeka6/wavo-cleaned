import { registerPlugin } from '@capacitor/core'
import { isNativeApp, isIOS } from './lib/platform'

const WavoCallKit = registerPlugin('WavoCallKit')

export function callKitSupported() {
  return isNativeApp && isIOS()
}

export async function getCallKitState() {
  if (!callKitSupported()) return {}
  try {
    return await WavoCallKit.getState()
  } catch (err) {
    console.info('[wavo callkit] native bridge not available', err?.message || err)
    return {}
  }
}

export async function consumePendingCallKitAction() {
  if (!callKitSupported()) return null
  try {
    const result = await WavoCallKit.consumePendingAction()
    return result?.action || null
  } catch (err) {
    console.info('[wavo callkit] pending action unavailable', err?.message || err)
    return null
  }
}

export async function endNativeCall(callId) {
  if (!callKitSupported() || !callId) return
  try {
    await WavoCallKit.endCall({ callId })
  } catch (err) {
    console.info('[wavo callkit] native end failed', err?.message || err)
  }
}

export async function addCallKitActionListener(listener) {
  if (!callKitSupported()) return null
  try {
    return await WavoCallKit.addListener('callAction', listener)
  } catch (err) {
    console.info('[wavo callkit] action listener unavailable', err?.message || err)
    return null
  }
}

export async function addVoipTokenListener(listener) {
  if (!callKitSupported()) return null
  try {
    return await WavoCallKit.addListener('voipToken', listener)
  } catch (err) {
    console.info('[wavo callkit] token listener unavailable', err?.message || err)
    return null
  }
}
