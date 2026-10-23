# Wavo 2.0: existing game security audit (2026-10-23)

## Observed implementation
- `src/Phase3Hub.jsx` currently renders Tic Tac Toe and Connect 4.
- `src/phase3Data.js` uses `public.chat_games` for turn-based games.
- `startPhase3Game` inserts games from the client.
- `playPhase3Game` reads game state, validates the move **in browser JavaScript**, and updates game state with optimistic concurrency using `updated_at`.
- The database has existing `games` and `chat_games` tables. Do not create duplicates until their schemas and usage are reconciled.

## Read-only production policy findings
Reviewed `pg_policies` for `public.chat_games` and `public.games`:
- `chat_games` SELECT is limited to creator or opponent.
- `chat_games` INSERT requires authenticated creator and friendship check.
- `chat_games` UPDATE allows either participant to update the row, subject to a participant ownership check.
- `games` has an `ALL` policy for `public` with `USING (true)` and `WITH CHECK (true)`.

## Risks requiring investigation
1. **Integrity:** Client-side move checks do not secure game state. Participants may bypass the browser and submit arbitrary `state`/winner fields unless a DB trigger or RPC validates them. Confirm any existing DB triggers before proposing a change.
2. **Access control:** The broad `games` policy permits all operations at the RLS layer to any role with underlying table privileges. Audit grants and dependent consumers before replacing it.
3. **Consistency:** Optimistic `updated_at` checks protect against ordinary simultaneous writes but are not an authorization boundary.
4. **Account protections:** Ensure any game invitations respect block lists and do not reveal private user data.

## Safe next steps
1. Inspect `chat_games` and `games` columns, grants, triggers, and dependent app code.
2. Write a read-only RLS test matrix for creator, opponent, third-party and anonymous users.
3. Prototype a server-validated move function in an isolated staging database, using locked rows, strict move validation and server-side current-user identity.
4. Add tests for invalid turns, overwritten winners, finished games, duplicate updates, race conditions and blocking.
5. Deploy only after current clients can use a compatible interface and backups are verified.

No game database policies or rows were modified as part of this audit.
