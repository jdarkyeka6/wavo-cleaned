# Wavo iPhone Duo adaptation (review branch)

Scope: native Capacitor iOS app on a resizable iPhone Duo window. This work does
not deploy, merge, sign, upload to TestFlight or change Supabase data.

## What this branch changes

- Detect **available native window width**, not iPhone vs iPad hardware identity.
  At 700 CSS px and up, show the active DM and a conversation selector in two
  panes; below 700 CSS px, use Wavo's existing single-pane DM experience.
- Preserve the selected friend and typed message through fold/unfold resizing.
  Do not remount the entire app on window changes.
- Reset the keyboard viewport baseline on large width changes caused by folding
  or rotating, instead of interpreting the geometry change as a keyboard.
- Respect asymmetric safe-area insets, scroll chat and sidebar independently,
  and limit inline media to the conversation pane.
- Add a **non-release** GitHub Actions check that compiles the iOS app with the
  iOS 27.1 SDK, plus pure viewport regression tests.

## Required validation before releasing

1. Run `node --test tests/iphone-duo-layout.test.mjs` and `npm run build`.
2. Confirm the unsigned Xcode 27.1 build check passes.
3. In Xcode 27.1's iPhone Duo simulator/Device Hub:
   - Closed: inbox and conversation use the existing narrow layout.
   - Open: selecting a DM shows a friend list on the left and chat on the right.
   - Fold/unfold while composing: the selected DM and draft survive.
   - Rotate/resize through <700 px and >=700 px; no clipped sidebar or composer.
   - Open keyboard; composer remains visible; no blank strip or scroll trap.
   - Test safe areas around the relocated camera/status bar and home indicator.
   - Scroll old messages, send a new message and switch selected friends.
   - Check calls, images, Waves/video, Spaces, notifications and purchase sheets.
4. Test a signed build on physical iPhone Duo. Do not call this verified until
   actual on-device results are recorded.
5. With explicit release approval, separately update the signed TestFlight
   workflow from Xcode 26.3/macOS 15 to Xcode 27.1 on the xcode-27 runner,
   validate signing and App Store compatibility, then ship.

No production changes should be made from this review branch automatically.
