// src/lib/platform.js
//
// Tells the app whether it's running inside the native iOS/Android shell
// or on the web at wavo.lol.
//
// App Store release rule:
// Wavo's current native app is free-only. Paid Wavo plans are web products,
// so native builds must not show purchase UI, prices, external checkout links,
// or unlock paid digital features bought on another platform.

import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android app shell, false in a normal browser. */
export function isNative() {
  return Capacitor.isNativePlatform();
}

/**
 * Boolean form of isNative(), for `{!isNativeApp && ...}` in JSX.
 * The platform can't change while the page is open, so evaluating once at
 * module load is safe.
 */
export const isNativeApp = isNative();

/** 'ios' | 'android' | 'web' */
export function getPlatform() {
  return Capacitor.getPlatform();
}

export function isIOS() {
  return getPlatform() === 'ios';
}

/** Paid Wavo digital features are currently web-only. */
export function canUsePaidFeatures() {
  return !isNative();
}

/** Prices, upgrades and checkout are web-only too. */
export function canShowBilling() {
  return !isNative();
}

/**
 * Guard for anything that navigates the user toward payment.
 * A stray native button must never open checkout.
 */
export function assertBillingAllowed() {
  if (!canShowBilling()) {
    console.warn('[wavo] Billing UI suppressed in the native free-only app');
    return false;
  }
  return true;
}
