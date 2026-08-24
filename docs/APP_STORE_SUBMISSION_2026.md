# Wavo App Store submission — 2026 release candidate

This file is the release checklist for the `app-store-submission-2026` branch.

## Release identity

- App name: Wavo
- Bundle ID: `lol.wavo.app`
- Marketing version: `1.0`
- Build: `10`
- Native shell: Capacitor iOS
- Minimum iOS deployment target in Xcode project: iOS 15
- App Store upload requirement: archive and upload with **Xcode 26 or later using the iOS 26 SDK or later**.

## App Store positioning

Wavo is a private friend-and-group coordination app. It is not anonymous chat and it is not an open public follower network.

Core features to show App Review:

- persistent one-to-one messaging with offline queueing
- Spaces that keep group chat, plans, polls and activities together
- friend-scoped Posts with all-friends or selected-person audiences
- Waves for quick friend/Space updates and reactions
- opt-in arrival/location sharing with user privacy controls
- native push notifications and voice notes
- reporting, blocking, Community Standards, support and permanent account deletion

## App Review safety checks

The build includes:

- server-side filtering on new Posts, Waves, DMs and Space messages
- in-app reporting through the persistent Safety Centre
- content-specific reporting on the dedicated Waves experience
- block/unblock controls backed by the existing block system
- a support queue and published support email
- Community Standards inside the app
- permanent account deletion inside the app
- deletion cleanup for associated Wavo data and uploaded files handled by the server-side deletion flow

Before uploading, create or choose an App Review demo account that has at least:

- one accepted friend
- one Space
- a few DM and Space messages
- one Post
- one Wave
- one plan and one poll

Do not give App Review an empty account if a populated reviewer account is available. The reviewer should be able to see the differentiating features immediately.

## App privacy URLs

Use these App Store Connect URLs:

- Privacy Policy: `https://wavo.lol/privacy.html`
- Support URL: `https://wavo.lol/support.html`
- Terms: `https://wavo.lol/terms.html`

## Age-rating questionnaire

Answer based on the features actually shipped, not the marketing category.

- Messaging and Chat: **Yes**
- Social Media: **Yes** — Wavo includes a feed-style experience with friend-created Posts/Waves and reactions.
- Social Media Disabled for Users Under 13: **No** unless Wavo later implements Apple's Declared Age Range API and genuinely disables those capabilities for under-13 users.
- Advertising: **No**
- Unrestricted Web Access: **No**

Apple's current definitions give apps with Social Media capabilities a minimum general rating of 13+, and Australia applies a 16+ regional rating to apps with the Social Media descriptor.

## App Privacy questionnaire — data map

Review the final App Store Connect questionnaire against production before submitting. For the current build, the likely disclosures include data linked to the user's account for app functionality:

- User ID / account identifier
- User Content: messages, Posts, Waves, group/Space content, photos/videos/voice notes and support/report content where applicable
- Other User Content: plans, polls, activities, reactions, nicknames and profile text
- Precise or Coarse Location when a user chooses arrival/location sharing
- Device ID / push token or equivalent notification identifier
- Product Interaction / app activity needed for presence, read state, streaks and feature operation

Wavo does not show third-party advertising and should not declare data as used for third-party advertising unless the implementation changes.

## Payments

The native iOS app must not expose Stripe checkout, external digital-purchase links, subscription prices or a web-upgrade call to action.

The current `Premium` component suppresses purchase UI on native platforms using Capacitor native-platform detection. Existing server-side account entitlements may still be displayed.

## Native permission check

The current iOS Info.plist contains purpose strings for:

- microphone: voice notes
- location when in use: user-initiated arrival/location sharing
- remote notification background mode

Do not add Camera or full Photo Library permission merely for a system media picker unless a native feature is added that actually requires those permissions.

## Final release sequence

1. Pull `app-store-submission-2026` on the Mac used for release.
2. Run `npm ci` or the repository's normal clean install.
3. Run `npm run build`.
4. Run `npm run ios:sync`.
5. Open the iOS project with `npm run ios:open`.
6. Confirm the Apple Developer Team and signing profile for `lol.wavo.app`.
7. Confirm Release uses the production push entitlement.
8. Confirm the archive reports Wavo 1.0 build 10.
9. Test the Release build on a physical iPhone: login, Home, Inbox, DM back navigation, Space back navigation, Post/Wave creation, report, block, support, push prompt, voice-note microphone prompt, location sharing and account deletion on a disposable account.
10. Archive with Xcode 26+ / iOS 26 SDK+, Validate App, then upload to App Store Connect.
11. Complete App Privacy and Age Rating honestly from this document and the final binary.
12. Add the prepared App Review notes and a populated review account.

## Do not submit if

- any visible button is a dead control
- the reviewer account opens to an empty or broken experience
- the Safety button is hidden or covered by the bottom navigation
- account deletion does not complete on a disposable test account
- native iOS shows a Stripe/external Premium purchase flow
- Release push entitlement is not production
- the archive was made with an Xcode/SDK version below Apple's current upload requirement
