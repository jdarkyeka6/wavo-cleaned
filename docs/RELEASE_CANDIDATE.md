# Wavo 1.0 (10) — App Store release candidate

Branch: `app-store-submission-2026`

Status at preparation:

- Vercel build: passing
- App version: 1.0
- Build number: 10
- Bundle ID: `lol.wavo.app`
- App Store safety flow: present
- Account deletion: present and server-backed
- UGC filter/report/block controls: present
- Privacy/support/terms pages: updated for this build
- Audience RLS: verified for Waves, Posts, Spaces, DMs, polls and activities
- Internal Supabase trigger/scheduler RPCs: removed from client execution
- App Review notes/checklist: included in `docs/`

This branch is ready for the final physical-device Release smoke test and Xcode 26+ archive/signing step. Do not archive from `main` until this release candidate is merged or deliberately selected in Xcode.
