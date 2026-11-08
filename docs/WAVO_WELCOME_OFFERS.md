# Wavo: Pick your welcome deal (draft / not live)

## Web offers

- **half1:** 50% off first invoice (Stripe coupon: `percent_off=50`, `duration=once`).
- **twoforone:** Two months for the price of one, implemented as 50% off the first two monthly invoices (`percent_off=50`, `duration=repeating`, `duration_in_months=2`). Clearly disclose this split-billing approach; it is economically equivalent to a free second month but not literally billed at full price then free.
- **quarter2:** 25% off the first two monthly invoices (`percent_off=25`, `duration=repeating`, `duration_in_months=2`).

These are mutually exclusive; student plans already discounted are excluded.

## Deployment requirements

1. Create the three coupons in the **correct Stripe mode** and verify their duration/percent values (do not create them in live mode without approval).
2. Set server-side env: `WAVO_WELCOME_OFFERS_ENABLED=true`, `WAVO_WELCOME_HALF1_COUPON_ID`, `WAVO_WELCOME_TWOFORONE_COUPON_ID`, `WAVO_WELCOME_QUARTER2_COUPON_ID`.
3. Set build-time env `VITE_WAVO_WELCOME_OFFERS_ENABLED=true`.
4. Verify the Stripe account and webhook are the intended target; test in sandbox, including the third renewal invoice, cancellation, returning subscriber, student price exclusion and abandoned checkout.
5. Verify price disclosure matches the actual invoice including any applicable tax and currency behavior.
6. **Do not advertise these as available in the native iOS app.** Wavo uses StoreKit there. Apple subscription offers must be configured and tested separately in App Store Connect.

## Server security

- The server ignores client-supplied percentages or coupon IDs. It only accepts allowlisted offer names and retrieves the configured coupon from Stripe.
- For a selected welcome offer, it rejects any Stripe customer who already has subscription history and disallows additional promotion-code stacking.
- Eligibility is per Wavo/Stripe customer, not a robust identity-wide anti-abuse guarantee; examine alternate identities and historical customer records before production rollout.
- Feature flag defaults to off; this PR does not activate or create any live coupon, payment or subscription.
