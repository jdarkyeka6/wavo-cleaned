# Mainland China CallKit App Review mitigation

Apple requires CallKit to be inactive in apps offered on the mainland China App Store.

## Changes
- iOS native bridge checks the StoreKit storefront (CHN) and device locale region (CN).
- In mainland China, Wavo does not initialize CXProvider or register PushKit VoIP notifications.
- Native answer/end-call requests are ignored there. Elsewhere existing CallKit behaviour is retained.

## Required before production release
1. Verify this behavior on a mainland China storefront account, not only a device with its region set to China. Confirm no CallKit startup or incoming system UI.
2. Implement and test **regular APNs notification** delivery for calls to China-region users. The server currently relies on a VoIP token for the native incoming-call path; disabling that token without a fallback can prevent incoming call alerts.
3. Test outgoing calls and calls accepted inside the app, including audio-only calls.
4. Verify that App Review accepts a binary that still links CallKit but leaves it inactive in China. If the binary itself is flagged, ship a separate non-CallKit China build or remove CallKit from the universal binary.
5. Include a note to App Review: "CallKit is disabled for mainland China. For StoreKit China storefronts (CHN) and China device regions (CN), Wavo does not initialize CXProvider or register PushKit VoIP notifications. Outside mainland China, normal CallKit operation remains available."

This patch is a proposed review mitigation, not proof of App Store approval. Do not merge or release until the fallback and validation are complete.
