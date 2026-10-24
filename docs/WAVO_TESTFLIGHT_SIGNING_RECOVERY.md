# Wavo Support v16: TestFlight signing recovery

**Status:** TestFlight build attempted on 2026-10-24, but the Apple upload did **not** happen.

- GitHub Actions run: https://github.com/jdarkyeka6/wavo-cleaned/actions/runs/40087056475
- Branch: `feature/wavo-support-smart-20261023`
- App ID: `lol.wavo.app`
- Completed: App Review and IAP/consent checks, Vite build, Capacitor sync, Ruby/Fastlane setup, privacy manifest validation.
- Blocked: `cert` failed with Apple's "maximum number of available Distribution certificates" error.
- **No Distribution certificate was revoked**, no App Store build was uploaded, and no production Supabase Edge Function was deployed.

## Safe recovery (preferred)

Reuse an **existing valid Apple Distribution signing identity with its private key** rather than creating another certificate. The .p8 App Store Connect API key currently used by CI is **not** a signing identity and cannot replace a distribution .p12.

If a trusted Mac has the original Apple Distribution identity:
1. In Keychain Access, find the valid Apple Distribution certificate under *My Certificates*. It must have the matching private key and belong to Wavo's signing team.
2. Export the identity to a password-protected `.p12`. Check the corresponding certificate is still valid in the Apple Developer account.
3. Save these values as GitHub **Actions repository secrets** for `jdarkyeka6/wavo-cleaned`:
   - `IOS_DISTRIBUTION_P12_BASE64`: Base64 contents of the complete binary `.p12`.
   - `IOS_DISTRIBUTION_P12_PASSWORD`: The password used when exporting the file.
   - `IOS_DISTRIBUTION_CERT_ID`: The corresponding Apple Distribution certificate's ID for Fastlane `sigh`.
4. Never commit, paste into an issue, or publish the private key, certificate bundle, password, API key, or encoded private key. Base64 is **not** encryption.
5. Trigger `iOS to TestFlight` using GitHub Actions **Run workflow** and select the feature branch, or deliberately update `.github/testflight-trigger` in that branch after checking the secrets.
6. Observe Xcode archive, signing, upload and Apple's TestFlight processing. A green upload means Apple accepted the artifact, **not** that Apple has finished processing or made it installable.

The feature-branch Fastlane lane imports that existing certificate into an ephemeral CI keychain and pins the Apple provisioning profiles to the provided certificate ID. It does not change production main. The branch workflow no longer automatically starts when the workflow file itself changes, avoiding costly failed reruns.

## If the matching private key is unavailable

A certificate that was created on a past ephemeral GitHub runner may not be recoverable. Do **not** revoke all certificates or revoke an unknown certificate automatically: other apps/builds may depend on them. The Apple Developer account owner must inspect which certificates are in use and deliberately resolve the quota. Consider setting up `fastlane match` with protected signing storage to avoid repeated certificate creation in CI.

## Support AI distinction

The iOS TestFlight build embeds React UI changes (Support quick-start prompts and account-history loading protections). The actual Support AI v16 model and improved server handler run in **Supabase Edge Functions** and are **not activated by an iOS upload**. The live `support-ai` function was last confirmed at version 15. Backend v16 requires a separate staging quality review and explicit deployment.

## Verified certificate dependencies (Apple read-only audit 2026-10-24)

Audit run: https://github.com/jdarkyeka6/wavo-cleaned/actions/runs/40088354786

- AJZTAG7VP4: used by ACTIVE Wavo App Store and Wavo Live Activity profiles. Preserve.
- RL2774MQCA: used by ACTIVE SnapShift. Preserve.
- DPJ24D5FLB: used by ACTIVE Fort Security and SnapShift. Preserve.

Apple has 3 Distribution certificates, and all 3 are linked to active App Store provisioning profiles. There is no unreferenced old Wavo certificate to revoke. Certificates are team-wide, not tied to a TestFlight build. Removing old builds or invalid provisioning profiles cannot free the certificate limit.

The development TestFlight workflow now requires a reusable Wavo .p12 with its private key, password and certificate ID before attempting a costly build. It only accepts the audited Wavo certificate ID AJZTAG7VP4, imports that identity into the temporary CI keychain, and never automatically creates or revokes any certificate.

If the private key was lost on an old ephemeral CI runner, neither the certificate ID nor the App Store Connect .p8 API key can recreate it. A Mac/keychain backup, protected signing storage or deliberate signing rotation by the Apple Account Holder is required. Do not revoke certificates referenced by the other active apps without a coordinated migration.
