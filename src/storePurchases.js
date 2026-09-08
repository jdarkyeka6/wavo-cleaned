import { Capacitor } from '@capacitor/core'
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases'
import { supabase } from './supabaseClient'

export const APPLE_PRODUCTS = {
  premium: 'lol.wavo.premium.monthly',
  pro: 'lol.wavo.pro.monthly',
}

export const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

async function accessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

async function verifyAppleTransaction(transaction) {
  if (!transaction?.jwsRepresentation) throw new Error('Apple did not return a verifiable StoreKit transaction yet.')
  const token = await accessToken()
  if (!token) throw new Error('Your Wavo session expired. Sign in again.')
  const response = await fetch('/api/apple-entitlement', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jwsRepresentation: transaction.jwsRepresentation }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || 'Apple subscription verification failed.')
  return payload
}

export async function loadStoreProducts() {
  if (!isNativeIOS()) return []
  const { isBillingSupported } = await NativePurchases.isBillingSupported()
  if (!isBillingSupported) return []
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: [APPLE_PRODUCTS.premium, APPLE_PRODUCTS.pro],
    productType: PURCHASE_TYPE.SUBS,
  })
  return products || []
}

export async function purchaseAppleTier(tier, userId) {
  const productIdentifier = APPLE_PRODUCTS[tier]
  if (!productIdentifier) throw new Error('Unknown Wavo plan.')
  if (!userId) throw new Error('Sign in before subscribing.')
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier,
    productType: PURCHASE_TYPE.SUBS,
    quantity: 1,
    appAccountToken: userId,
  })
  return verifyAppleTransaction(transaction)
}

export async function restoreApplePurchases() {
  if (!isNativeIOS()) throw new Error('Restore Purchases is available in the iOS app.')
  await NativePurchases.restorePurchases()
  const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS, onlyCurrentEntitlements: true })
  const active = (purchases || [])
    .filter((p) => p?.isActive !== false && p?.jwsRepresentation && Object.values(APPLE_PRODUCTS).includes(p.productIdentifier))
    .sort((a, b) => (a.productIdentifier === APPLE_PRODUCTS.pro ? -1 : 1) - (b.productIdentifier === APPLE_PRODUCTS.pro ? -1 : 1))
  if (!active.length) throw new Error('No active Wavo subscription was found for this Apple ID.')
  let result = null
  for (const purchase of active) result = await verifyAppleTransaction(purchase)
  return result
}

export async function manageAppleSubscription() {
  if (!isNativeIOS()) return false
  await NativePurchases.manageSubscriptions()
  return true
}

export async function startWebCheckout(plan) {
  const token = await accessToken()
  if (!token) throw new Error('Sign in before subscribing.')
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || 'Checkout could not start.')
  if (!payload?.url) throw new Error('Checkout did not return a payment page.')
  window.location.href = payload.url
}
