// src/lib/platform.js
//
// Tells the app whether it's running inside the native iOS/Android shell
// or on the web at wavo.lol.
//
// Why this exists:
// Apple App Store Guideline 3.1.1 requires that digital subscriptions sold
// for use inside an iOS app go through In-App Purchase. Since Wavo Premium
// is sold via Stripe on the web, the iOS build must not show ANY purchase
// UI, prices, or links to the web paywall. Doing so is a rejection.
//
// The app still HONOURS premium bought on the web — badge, name colours and
// premium themes all work on iOS. It just can't advertise the door.

import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android app shell, false in a normal browser. */
export function isNative() {
  return Capacitor.isNativePlatform();
}

/**
 * Boolean form of isNative(), for `{!isNativeApp && ...}` in JSX.
 * The platform can't change while the page is open, so evaluating once at
 * module load is safe — and it keeps call sites from accidentally rendering
 * a truthy function reference.
 */
export const isNativeApp = isNative();

/** 'ios' | 'android' | 'web' */
export function getPlatform() {
  return Capacitor.getPlatform();
}

export function isIOS() {
  return getPlatform() === 'ios';
}

/**
 * Whether the UI may show prices, upgrade buttons, or links to checkout.
 *
 * Android technically permits external payment links in more cases than
 * iOS does, but gating both keeps ONE code path and avoids tripping
 * Google Play's equivalent policy. Flip this to `!isIOS()` only if you
 * later decide to sell on Android web.
 */
export function canShowBilling() {
  return !isNative();
}

/**
 * Guard for anything that navigates the user toward payment.
 * Use in click handlers as a last line of defence, so a stray button
 * can never open checkout inside the native app.
 */
export function assertBillingAllowed() {
  if (!canShowBilling()) {
    console.warn('[wavo] Billing UI suppressed on native platform (App Store 3.1.1)');
    return false;
  }
  return true;
}
