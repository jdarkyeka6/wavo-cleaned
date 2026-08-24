# App Store Connect — App Privacy answer guide

Use this as a verification guide, not a substitute for checking the final production configuration in App Store Connect.

## Tracking

- Data used to track users across apps/websites owned by other companies: **No**, unless production tracking behavior changes.

## Data linked to the user

The following can be linked to a Wavo account because they are required to operate account features:

### Contact / identifiers
- User ID / account identifier: account operation and authentication.
- Do not declare a real email address as collected by the native app unless the submitted signup/profile flow actually asks users for one.

### User Content
- Direct and group/Space messages.
- Posts and Waves.
- Photos, videos, voice notes and other media users choose to upload.
- Support requests and reports where applicable.
- Profile text/status/bio.
- Plans, polls, activities, reactions and similar user-created app content.

Primary purpose: App Functionality. Safety/report data can also serve Security/Fraud Prevention or equivalent safety purposes where App Store Connect offers the applicable purpose.

### Location
- Precise Location and/or Coarse Location when the user explicitly chooses arrival/location sharing.
- Purpose: App Functionality.
- Location is not required for ordinary messaging.

### Usage Data
- Product Interaction / feature activity needed for presence, read state, streaks, activity counters and service operation.
- Purpose: App Functionality and, where accurate for the exact field, Analytics.

### Device identifiers
- Push/device subscription token used to deliver notifications.
- Purpose: App Functionality.

## Purchases

The iOS binary does not offer Stripe checkout. If App Store Connect asks about purchase history/data because Wavo receives server-side entitlement/payment status from purchases outside the iOS app, answer according to the exact production data retained by the account backend.

## Advertising

- Third-party advertising: No.
- Developer advertising/marketing use of collected user data: No, unless the implementation changes.

## Important

Do not copy these answers mechanically if production changes before upload. Apple's disclosure must match what the submitted binary and backend actually collect and use.
