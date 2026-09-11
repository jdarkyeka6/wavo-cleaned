# Wavo 1.0 (Build 38) — App Review Notes

## Intended storefronts
Wavo is intended for all available App Store storefronts.

## What Wavo is
Wavo is a social messaging app for direct messages, Spaces (group conversations), posts/Waves, plans, polls, voice/video calls, presence, notifications and social activity.

The iOS app uses a Capacitor shell around Wavo's React interface, but it is not submitted as a simple website wrapper. The iOS build integrates native iOS capabilities and app-specific flows, including:

- APNs push notifications tied to the signed-in Wavo account.
- Native call/VoIP support and call signalling for Wavo voice/video calls.
- Live Activity support for supported Wavo activity.
- Native photo/camera/media access where the user chooses those features.
- Native iOS subscription support where applicable to the submitted storefront/build.
- Native alternate-platform handling, safe-area/keyboard handling and iOS-specific lifecycle behaviour.

The core product remains fully usable as a messaging/social app without enabling optional device permissions such as location or notifications.

## Account deletion
Wavo supports permanent in-app account deletion.

Path:
**You → Account → Delete account**

The user confirms the deletion by typing `DELETE`. Wavo then removes the user's account-linked profile/social data and Wavo-owned uploaded files, deletes the authentication account, clears local user data and signs the user out.

A physical-device screen recording showing sign-in, navigation to the deletion control, confirmation and completed deletion should be attached in App Review Information before submission.

## Privacy, support and legal information
From the signed-in **You** screen, reviewers can directly access:

- Wavo Support
- Privacy Policy
- Terms
- Account deletion

The Privacy Policy documents the categories of data Wavo processes, service providers, purposes, user controls and account/data deletion.

## User-generated content safety
Wavo includes safety controls for user-generated content, including:

- automated objectionable-content moderation for supported posting/message flows,
- user reporting,
- blocking,
- Wavo Support/contact information, and
- admin moderation/report-review tools.

## Review access
Please use the demo/review credentials supplied in App Store Connect. The Wavo backend must remain online during review so account, messaging, moderation, notification and deletion functionality can be exercised.

## Changes addressing the previous review
- Finalized App Store icon handling so the submitted build uses the primary finalized Wavo icon rather than registering the cosmetic alternate icon set for App Store submission.
- Added/confirmed permanent in-app account deletion and hardened the server-side deletion path.
- Added direct Privacy Policy and Terms access from the signed-in You screen.
- Expanded privacy-policy service-provider protection language.

## Reviewer note
If a permission is declined, Wavo should continue to provide its unrelated core features. Location sharing, notifications, camera/media and similar device features are optional and requested only when relevant to the feature the user chooses.
