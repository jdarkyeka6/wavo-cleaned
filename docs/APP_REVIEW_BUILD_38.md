# Wavo 1.0 — Current App Review Notes

## Intended storefronts
Wavo is intended for all available App Store storefronts.

## What Wavo is
Wavo is a social messaging app for direct messages, Spaces (group conversations), posts/Waves, plans, polls, voice/video calls, presence, notifications and social activity.

The iOS app uses a Capacitor shell around Wavo's React interface, but it is not submitted as a simple website wrapper. The iOS build integrates native iOS capabilities and app-specific flows, including:

- APNs push notifications tied to the signed-in Wavo account.
- Native call/VoIP support and call signalling for Wavo voice/video calls.
- Live Activity support for supported Wavo activity.
- Native photo/camera/media access where the user chooses those features.
- StoreKit/App Store In-App Purchase for Wavo digital subscriptions.
- Native safe-area, keyboard and iOS lifecycle behaviour.

The core product remains fully usable as a messaging/social app without enabling optional device permissions such as location or notifications.

## iOS business model and In-App Purchase
Wavo offers optional monthly Premium, Plus and Pro subscriptions in the iOS app using Apple In-App Purchase.

Apple product identifiers:

- `lol.wavo.premium.monthly`
- `lol.wavo.plus.monthly`
- `lol.wavo.pro.monthly`

The iOS app does not send users to Stripe or Wavo web checkout. Web purchases are handled separately on the Wavo website. An active paid entitlement can be used by the signed-in Wavo account across supported platforms when the corresponding digital plan is available in the iOS app.

The subscription screen includes StoreKit pricing, monthly-renewal disclosure, Restore Purchases, Manage Subscription, Terms of Use and Privacy Policy links.

Paid feature levels shown in the submitted app are:

- **Premium:** Profile Studio and chat themes, message effects and animated reactions, chat folders and advanced search, recurring messages and streak protection, and Wavo Labs.
- **Plus:** everything in Premium, plus AI chat summaries, Ask Wavo and voice-note transcription.
- **Pro:** everything in Plus, plus Space analytics, advanced Space roles and scheduled Space announcements.

The app shows the exact current tier and does not present a lower included tier as a separate current subscription.

## AI disclosure and consent
Wavo Support AI and optional paid Wavo AI features use OpenAI. Before content is sent to a Wavo AI feature, Wavo identifies OpenAI as the third-party AI provider, warns the user not to send sensitive information and requires explicit consent.

Ordinary Wavo message/post moderation uses Wavo's first-party safety filter and does not silently send ordinary private messages to OpenAI.

## Account deletion
Wavo supports permanent in-app account deletion.

Path:
**You → Account → Delete account**

The user confirms the deletion by typing `DELETE`. Wavo then removes the user's account-linked profile/social data and Wavo-owned uploaded files, deletes the authentication account, clears local user data and signs the account out.

## Privacy, support and legal information
From the signed-in **You** screen, reviewers can directly access:

- Wavo Support
- Privacy Policy
- Terms
- Account deletion

The public `/support` page also provides `contact@builtbyjake.site` without requiring sign-in. The Privacy Policy identifies Wavo's relevant service providers, including Apple, Stripe, Supabase, Vercel, Google Drive, OpenAI, GIPHY, Spotify and web-only Google Analytics.

## User-generated content safety
Wavo includes safety controls for user-generated content, including:

- first-party objectionable-text filtering for supported posting/message flows,
- user reporting,
- blocking,
- Wavo Support/contact information, and
- admin moderation/report-review tools.

## Review access
Please use the demo/review credentials supplied in App Store Connect. The Wavo backend must remain online during review so account, messaging, moderation, notification, purchase and deletion functionality can be exercised.

For testing subscriptions, the App Store build uses the Apple sandbox/TestFlight purchase environment automatically when applicable. Reviewers can use the in-app Restore Purchases and Manage Subscription controls.

## Reviewer note
If a permission is declined, Wavo should continue to provide its unrelated core features. Location sharing, notifications, camera/media and similar device features are optional and requested only when relevant to the feature the user chooses.
