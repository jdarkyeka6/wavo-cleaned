// src/lib/platform.js
//
// Tells the app whether it's running inside the native iOS/Android shell
// or on the web at wavo.lol.
//
// Paid Wavo features are available on iOS through Apple In-App Purchase.
// Native builds must never send users to Wavo's web checkout. Web builds may
// continue to use Stripe checkout.

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

/** Paid features may be used on every supported Wavo platform. */
export function canUsePaidFeatures() {
  return true;
}

/** External/web checkout is browser-only. Native iOS uses Apple IAP instead. */
export function canShowBilling() {
  return !isNative();
}

/**
 * Guard for anything that navigates the user toward Wavo's web checkout.
 * A stray native button must never open Stripe or an external purchase page.
 */
export function assertBillingAllowed() {
  if (!canShowBilling()) {
    console.warn('[wavo] Web checkout suppressed in the native app; use Apple IAP');
    return false;
  }
  return true;
}
