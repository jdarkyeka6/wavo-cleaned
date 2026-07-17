// Are we running inside the native iOS/Android app, or on the website?
//
// We deliberately do NOT import "@capacitor/core" here. That package is the
// bridge to phone hardware — the website has no need for it, and importing it
// makes the web build (Vercel) fail because the dependency isn't installed
// there. Instead we read the global that Capacitor injects into the page ONLY
// when the code is running inside the native shell. On wavo.lol that global
// never exists, so isNativeApp is false and the website behaves normally.

function detectNative() {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // Preferred: Capacitor's own check, if the native runtime exposes it.
  if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  // Fallback: read the platform string it injects.
  const platform =
    typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
  return platform === "ios" || platform === "android";
}

// true only inside the native iOS/Android app; false on the website (wavo.lol)
export const isNativeApp = detectNative();
