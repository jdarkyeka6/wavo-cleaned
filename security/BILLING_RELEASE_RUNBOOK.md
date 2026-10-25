# Wavo billing-ID privacy rollout

## Stage A: completed, not hypothetical
On 2026-10-25, Supabase migration `20261025153352_wavo_create_private_stripe_customer_store_stage_a` created the protected `public.wavo_billing_customer_links` table and copied 7 Stripe customer IDs from the existing profile rows.
Database read-back verification: 7 private records, 7 legacy records, 0 mismatches; RLS enabled; no anon/authenticated SELECT or INSERT permission; service role SELECT and INSERT allowed. The 33 profile rows were unchanged.

## Stage B: NOT completed
The 7 legacy customer IDs remain visible through overbroad SELECT access to `profiles`.
This PR replaces the *server-side checkout and subscription cancellation* lookup with the private store. Once deployed and validated, the later `security/sql/REVIEW_ONLY_stripe_private_stage_b_cutover.sql` script in PR #100 can clear the legacy field and block new public-field writes.
There is NO automatic Stage B migration in this PR.

### Release order and checklist

1. Verify GitHub billing tests, browser build and Vercel preview are green.
2. Check for stale use of `profiles.stripe_customer_id` in server code and update all routes before release.
3. Perform a real test-mode API checkout and cancellation smoke test. Do not use or modify a real customer/subscription for testing.
4. Deploy just this isolated server patch to production.
5. Verify private store is accessible to server role and checkout reuses an existing Stripe customer ID.
6. Test cancellation safely in test mode, check service logs and confirm webhook behavior.
7. Verify the private count still matches all non-null public values. Then apply the reviewed Stage B migration only after checks and explicit readiness.
8. Check that no public profile row still holds a Stripe ID. Verify customer identity reuse and monitor errors.

### Rollback

Before Stage B: reverting to previous checkout/cancellation endpoints is possible because old profile values are still present. Leave private table/backfill untouched.
After Stage B: **do not revert to the original endpoints**, which expect the now-cleared profile field. If a server rollback is needed, preserve/redeploy the updated private lookup module.

### What this does not fix

General private profile fields (e.g. birthday) remain readable via legacy authenticated `profiles` SELECT permissions. The broader column-grant restriction remains blocked on older iOS clients, as described in PR #100.

### Verification boundaries

Mocked unit tests do NOT simulate an actual Stripe sandbox checkout or cancellation. No real account was charged and no live subscription was modified. The new `getCheckoutReturnOrigin` prevents request-supplied Origin/Host headers from defining Stripe post-checkout URLs, using a trusted HTTPS deployment setting or the canonical Wavo domain instead.
