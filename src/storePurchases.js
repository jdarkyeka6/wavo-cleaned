import { Capacitor } from '@capacitor/core'
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases'
import { supabase } from './supabaseClient'

export const APPLE_PRODUCTS = {
  premium: 'lol.wavo.premium.monthly',
  plus: 'lol.wavo.plus.monthly',
  pro: 'lol.wavo.pro.monthly',
}

const APPLE_TIER_RANK = {
  [APPLE_PRODUCTS.premium]: 1,
  [APPLE_PRODUCTS.plus]: 2,
  [APPLE_PRODUCTS.pro]: 3,
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
  const { data, error } = await supabase.functions.invoke('apple-entitlement', {
    body: { jwsRepresentation: transaction.jwsRepresentation },
    headers: { Authorization: `Bearer ${token}` },
  })
  if (error) throw new Error(data?.message || data?.error || error.message || 'Apple subscription verification failed.')
  if (!data?.ok) throw new Error(data?.message || data?.error || 'Apple subscription verification failed.')
  return data
}

export async function loadStoreProducts() {
  if (!isNativeIOS()) return []
  const { isBillingSupported } = await NativePurchases.isBillingSupported()
  if (!isBillingSupported) return []
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: Object.values(APPLE_PRODUCTS),
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

async function currentApplePurchases() {
  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.SUBS,
    onlyCurrentEntitlements: true,
  })
  return (purchases || [])
    .filter((purchase) => purchase?.isActive !== false && purchase?.jwsRepresentation && Object.values(APPLE_PRODUCTS).includes(purchase.productIdentifier))
    .sort((a, b) => (APPLE_TIER_RANK[b.productIdentifier] || 0) - (APPLE_TIER_RANK[a.productIdentifier] || 0))
}

export async function reconcileApplePurchases() {
  if (!isNativeIOS()) return null
  const { isBillingSupported } = await NativePurchases.isBillingSupported()
  if (!isBillingSupported) return null
  const active = await currentApplePurchases()
  if (!active.length) return null
  return verifyAppleTransaction(active[0])
}

export async function restoreApplePurchases() {
  if (!isNativeIOS()) throw new Error('Restore Purchases is available in the iOS app.')
  await NativePurchases.restorePurchases()
  const active = await currentApplePurchases()
  if (!active.length) throw new Error('No active Wavo subscription was found for this Apple ID.')
  return verifyAppleTransaction(active[0])
}

export async function manageAppleSubscription() {
  if (!isNativeIOS()) return false
  await NativePurchases.manageSubscriptions()
  return true
}

export async function startWebCheckout(plan) {
  if (isNativeIOS()) throw new Error('Web checkout is not available in the iOS app. Use Apple In-App Purchase.')
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
