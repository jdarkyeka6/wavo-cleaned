# Wavo 2.0: safe rollout baseline

This branch is **not a Wavo 2.0 public launch**. It introduces a default-off client feature flag utility and tests, without modifying existing chat, authentication, billing, notifications, UI routing, or Supabase tables.

## Verified deployment ownership
On 2026-10-23, Vercel project `wavo` (serving `wavo.lol`) reported deployment `dpl_7wMvTagAwCg1p2mYa3uZ5rHNtegw` from `jdarkyeka6/wavo-cleaned` `main` commit `1fbca04c96e20a9b5411a5107eca03b25f0ea6bd`.

The separate `wavo-clean` project is **not** assumed to be production.

## Rollout contract
1. Keep all Wavo 2.0 features disabled until migrations, RLS, server-side authorization, analytics privacy review and end-to-end tests pass.
2. Treat client flags as presentation only, never as security protection.
3. First stabilise startup notification routing, duplicate events and keyboard viewport behaviour with regressions.
4. Run additive migrations on staging first. Verify older clients, backup restoration, and RLS tests before production migration.
5. Introduce Play (solo and asynchronous challenge), then Discover, then Identity as independent opt-in modules.
6. Enable named internal accounts before any general rollout.
7. If any P0 regression occurs, disable the feature immediately. Do not drop tables or restore an older database merely to roll back the UI.

## Verification
```bash
node --test tests/wavo2FeatureFlags.test.mjs
npm run lint
npm run build
```

## Pending prerequisites
- Inspect actual production Supabase schema, policies, RPCs, and existing game/activity implementation.
- Confirm staging project isolation and backups.
- Check latest mobile build compatibility before modifying message schema.
- Add feature-flag fetch and server-authorized cohort targeting only after the backend is audited.
