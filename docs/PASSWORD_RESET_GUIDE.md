# Wavo password recovery

Wavo's password recovery is implemented with a Supabase Edge Function, private database tables and Resend email delivery. The older client-side/API-route prototype described in this file has been retired.

## User flows

### Forgot password
1. From the login screen, tap **Forgot password?**.
2. Enter the Wavo username.
3. `account-recovery` looks up the account server-side.
4. If a verified recovery email exists, Wavo creates a random one-time token, stores only its SHA-256 hash, and emails a reset link.
5. The reset link expires after one hour and is invalidated after use.
6. The same generic response is returned whether or not the username exists, so the endpoint does not reveal account membership.

### Add or change a recovery email
1. Open **You → Account security**.
2. Enter the recovery email and current Wavo password.
3. Wavo verifies the current password server-side.
4. A one-time email-verification link is sent.
5. The recovery address becomes active only after that link is opened.

### Change password while signed in
**You → Account security → Change password** requires the current password and a new password of at least eight characters.

## Runtime files

- `src/AccountRecoveryEnhancement.jsx` — login/profile UI and reset-link handling.
- `src/account-recovery.css` — recovery UI styling.
- `supabase/functions/account-recovery/index.ts` — reset, verification and password-change server actions.
- `supabase/migrations/20261001033000_account_recovery.sql` — private recovery and reset-token tables.
- `public/privacy.html` — current recovery-email privacy disclosure.

## Database/security model

`account_recovery` is separate from `profiles`, because ordinary Wavo profile rows are visible to signed-in users. Recovery email addresses must not be stored in a public-facing profile field.

`password_reset_tokens` stores token hashes, expiry timestamps and usage state. Raw tokens exist only in the reset URL that is sent to the user.

`password_reset_attempts` stores hashed identifiers/IP values for rate limiting. Reset requests are limited per username and per source IP.

Changing a password or recovery email while signed in requires confirmation of the current Wavo password. Logged-out recovery requires the valid one-time reset token.

## Required Supabase Edge Function secrets

These values belong in Supabase Edge Function secrets. **Never use a `VITE_` variable for an email-provider secret, because Vite variables are shipped to the client bundle.**

```text
RESEND_API_KEY=<server-side Resend API key>
WAVO_EMAIL_FROM=Wavo <noreply@wavo.lol>
WAVO_PUBLIC_URL=https://wavo.lol
```

`WAVO_EMAIL_FROM` and `WAVO_PUBLIC_URL` have the values above as runtime defaults. `RESEND_API_KEY` is required for email delivery.

## Edge Function actions

The `account-recovery` function supports:

- `health`
- `status`
- `request-reset`
- `reset-password`
- `begin-email-verification`
- `verify-recovery-email`
- `change-password`
- `remove-recovery-email`

Public actions are intentionally served by a function with Supabase JWT verification disabled at the gateway because users must be able to request and complete a reset while logged out. Authenticated actions manually validate the bearer token with Supabase Auth before making account changes.
