# Wavo App Store reviewer smoke test

Run this against the exact Release archive candidate before upload.

## Signed out
- App opens without a black screen or crash.
- Username/password login is visible and usable.
- No Premium/Stripe purchase UI is visible in native iOS.

## Signed in
- Home renders friend-scoped Posts/Waves.
- Safety button is visibly labelled on a narrow iPhone.
- Inbox opens a DM and the back control returns to the list.
- Spaces opens a Space and the back control returns to Spaces.
- Create opens Post, Wave, Plan, Poll, Activity and Space options.

## UGC safety
- New obviously unsafe test content is rejected by the server-side filter.
- Safety -> Report someone submits a report.
- Safety -> Block & unblock can block and unblock a disposable test user.
- A non-owned Wave's action menu opens Report Wave / Block.
- Safety -> Contact Wavo submits a support request.

## Permissions
- Notifications are optional and do not block app use if declined.
- Microphone permission appears only when recording a voice note.
- Location permission appears only when choosing a location/arrival-share feature.

## Account deletion
Use a disposable account only.
- Safety -> Delete account is reachable without visiting a website.
- Typing DELETE enables the permanent-delete action.
- After deletion, the account is signed out and can no longer log in.
- Confirm the deleted profile/account is gone from production data.

## Release archive
- Bundle ID: lol.wavo.app
- Version: 1.0
- Build: 10
- Release APNs entitlement: production
- Archive built with Xcode 26+ / iOS 26 SDK+
- Validate App completes before upload
