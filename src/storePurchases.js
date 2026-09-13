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

const STORE_PRODUCT_IDS = Object.values(APPLE_PRODUCTS)
const STOREKIT_SUPPORT_TIMEOUT_MS = 5000
const STOREKIT_PRODUCTS_TIMEOUT_MS = 8000
let storeProductCache = null
let storeProductPromise = null

export const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

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

async function fetchStoreProductsOnce() {
  const billing = await withTimeout(
    NativePurchases.isBillingSupported(),
    STOREKIT_SUPPORT_TIMEOUT_MS,
    'The App Store did not respond while checking purchases.',
  )
  if (!billing?.isBillingSupported) throw new Error('App Store purchases are not available on this device.')

  const result = await withTimeout(
    NativePurchases.getProducts({
      productIdentifiers: STORE_PRODUCT_IDS,
      productType: PURCHASE_TYPE.SUBS,
    }),
    STOREKIT_PRODUCTS_TIMEOUT_MS,
    'The App Store took too long to load Wavo subscriptions.',
  )
  const products = Array.isArray(result?.products) ? result.products : []
  const missing = STORE_PRODUCT_IDS.filter((id) => !products.some((product) => product?.identifier === id))
  if (missing.length) throw new Error('The App Store has not returned all Wavo subscriptions yet. Try again in a moment.')
  return products
}

export async function loadStoreProducts({ force = false, retries = 3 } = {}) {
  if (!isNativeIOS()) return []
  if (force) storeProductCache = null
  if (storeProductCache?.length) return storeProductCache
  if (storeProductPromise && !force) return storeProductPromise

  const request = (async () => {
    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const products = await fetchStoreProductsOnce()
        storeProductCache = products
        return products
      } catch (error) {
        lastError = error
        if (attempt < retries) await delay(Math.min(3000, 750 * (attempt + 1)))
      }
    }
    throw lastError || new Error('Wavo could not load subscriptions from the App Store.')
  })()

  storeProductPromise = request
  try {
    return await request
  } finally {
    if (storeProductPromise === request) storeProductPromise = null
  }
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
    .filter((purchase) => purchase?.isActive !== false && purchase?.jwsRepresentation && STORE_PRODUCT_IDS.includes(purchase.productIdentifier))
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
