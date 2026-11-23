# Wavo security review: 2026-10-31

## Confirmed live risk (no data changed)
- `public.profiles`: all 34 columns have SELECT granted to `authenticated` and the `profiles readable` RLS policy accepts **any signed-in user**. The columns include personal account data, birthday, and legacy Stripe customer IDs. The existing draft PR #100 provides safe profile readers but older iOS builds still need migration before column-revokes; **this issue remains open**.
- Nine `SECURITY DEFINER` helpers are executable by `anon` (plus 51 exposed to `authenticated`, which require function-by-function authorization review). Calling these RPCs may reveal social or account metadata. Supabase's security lint flags them; a flagged function is not automatically exploitable.
- Supabase Auth leaked-password checks remain disabled. This requires separately reviewing and changing Auth settings.

## Changes on this branch (draft, safe to review)
1. `api/drive-resolve.js` now refuses ambiguous same-sized upload recovery instead of choosing an arbitrary recent Drive file. It additionally checks the `wavoUserId` and `wavoSource` properties supplied by Drive, preserving a unique-file fallback for older iOS uploads with renamed filenames.
2. A Node test suite exercises ambiguous matches, ownership filtering, mismatched source, Unicode normalisation and edge cases.
3. `security/sql/REVIEW_ONLY_wavo_anon_rpc_lockdown.sql` proposes revoking EXECUTE from the nine specific anonymous `SECURITY DEFINER` helpers after validation, and explicitly retaining signed-in/service callers. A matching rollback script restores observed ACL access.

## Release blockers
- Do **not** apply the SQL to live Supabase yet: RLS policies for `groups`, `group_members`, `plans`, `flags`, `messages`, etc. refer to these helpers. Although many use authenticated roles, several policies have roles `PUBLIC`. Test unauthenticated and authenticated operations in a disposable DB, then on existing iPhone and Android clients, before revocation.
- The profile-column risk is the highest impact privacy item and is **not** fixed here. Coordinate staged client migration in PR #100 and payment handling in PR #101 before removing broad SELECT grants; do not merge their incomplete cutovers blindly.
- Test the Drive-resolve fallback with two simultaneous same-sized uploads on iPhone. Ambiguous matches now intentionally return HTTP 409 and ask for a retry rather than potentially sending the wrong attachment.
- No production Supabase SQL was executed and no production branch merge was requested. Vercel previews are not production releases.

## Verification
Run `node --test tests/drive-resolve-candidate.test.mjs` and `npm run build`. CI must pass; also perform browser/iOS integration QA before release.
