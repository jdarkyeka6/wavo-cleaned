-- Wavo 2.0 candidate SQL. STAGING ONLY: DO NOT APPLY DIRECTLY TO PRODUCTION.
-- Requires test users, restored staging data, DB advisors and old-client tests.
-- Protects INSERT/UPDATE for the board games stored in public.chat_games.
-- This does not protect legacy public.games or chat_games 'rps'/'coin'.
-- All client operations remain subject to existing RLS policies.

create or replace function public.wavo2_board_game_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid;
  marker text;
  next_actor text;
  expected_winner text;
  expected_status text;
  board_size integer;
  old_board jsonb;
  new_board jsonb;
  i integer;
  r integer;
  c integer;
  changed_index integer := null;
  changed_count integer := 0;
  any_empty boolean := false;
  found_empty boolean;
  won boolean := false;
begin
  -- Existing coin/RPS behaviour is unchanged. Never allow a board game
  -- to be converted into another kind to bypass validation.
  if tg_op = 'UPDATE' and
     (old.kind in ('tic_tac_toe','connect4')
       or new.kind in ('tic_tac_toe','connect4'))
     and new.kind is distinct from old.kind then
    raise exception 'Game kind cannot be changed';
  end if;
  if new.kind not in ('tic_tac_toe','connect4') then
    return new;
  end if;

  -- Operations through the public API use authenticated/anon roles.
  -- Privileged maintenance roles are not expected to use client JWTs.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  actor := auth.uid();
  if actor is null or actor not in (new.creator_id, new.opponent_id) then
    raise exception 'Not a game participant';
  end if;

  board_size := case new.kind when 'tic_tac_toe' then 9 else 42 end;
  new_board := new.state -> 'board';
  if jsonb_typeof(new.state) is distinct from 'object'
     or jsonb_typeof(new_board) is distinct from 'array'
     or jsonb_array_length(new_board) <> board_size then
    raise exception 'Invalid game board';
  end if;

  if tg_op = 'INSERT' then
    if actor <> new.creator_id or new.status <> 'active'
       or new.state ->> 'turn' is distinct from new.creator_id::text
       or new.state ->> 'winner' is not null then
      raise exception 'Invalid initial game state';
    end if;
    for i in 0..board_size - 1 loop
      if new_board ->> i is not null then
        raise exception 'Initial game board must be empty';
      end if;
    end loop;
    -- A database clock, not client supplied timestamps.
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    return new;
  end if;

  if row(new.id,new.creator_id,new.opponent_id,new.kind,new.created_at)
       is distinct from
     row(old.id,old.creator_id,old.opponent_id,old.kind,old.created_at) then
    raise exception 'Game identity cannot be changed';
  end if;
  if old.status <> 'active' or old.state ->> 'winner' is not null
      or old.state ->> 'turn' is distinct from actor::text then
    raise exception 'Game is not active or it is not your turn';
  end if;
  if new.state - 'board' - 'turn' - 'winner'
       is distinct from old.state - 'board' - 'turn' - 'winner' then
    raise exception 'Unexpected game state changes';
  end if;

  old_board := old.state -> 'board';
  if jsonb_typeof(old_board) is distinct from 'array'
      or jsonb_array_length(old_board) <> board_size then
    raise exception 'Invalid previous board';
  end if;

  marker := case when actor = old.creator_id then 'a' else 'b' end;
  next_actor := case when actor = old.creator_id
    then old.opponent_id::text else old.creator_id::text end;

  for i in 0..board_size - 1 loop
    if (old_board ->> i) is not null and (old_board ->> i) not in ('a','b')
      or (new_board ->> i) is not null and (new_board ->> i) not in ('a','b') then
      raise exception 'Invalid board token';
    end if;
    if (old_board ->> i) is distinct from (new_board ->> i) then
      changed_count := changed_count + 1;
      changed_index := i;
      if old_board ->> i is not null or new_board ->> i is distinct from marker then
        raise exception 'Only one empty cell may be filled by the current player';
      end if;
    end if;
    if new_board ->> i is null then any_empty := true; end if;
  end loop;
  if changed_count <> 1 then raise exception 'Exactly one move is required'; end if;

  if new.kind = 'connect4' then
    -- Gravity: no occupied cell can have an empty square below it.
    for c in 0..6 loop
      found_empty := false;
      for r in reverse 5..0 loop
        if new_board ->> (r * 7 + c) is null then
          found_empty := true;
        elsif found_empty then
          raise exception 'Connect Four discs must fall to the bottom';
        end if;
      end loop;
    end loop;

    select exists (
      select 1
      from generate_series(0,5) as row_idx,
           generate_series(0,6) as col_idx,
           (values (0,1),(1,0),(1,1),(1,-1)) as direction(dr,dc)
      where row_idx + 3 * dr between 0 and 5
        and col_idx + 3 * dc between 0 and 6
        and new_board ->> (row_idx * 7 + col_idx) = marker
        and new_board ->> ((row_idx+dr)*7 + col_idx+dc) = marker
        and new_board ->> ((row_idx+2*dr)*7 + col_idx+2*dc) = marker
        and new_board ->> ((row_idx+3*dr)*7 + col_idx+3*dc) = marker
    ) into won;
  else
    select exists (
      select 1 from (values
        (0,1,2),(3,4,5),(6,7,8),
        (0,3,6),(1,4,7),(2,5,8),
        (0,4,8),(2,4,6)
      ) as line(a,b,c)
      where new_board ->> a = marker
        and new_board ->> b = marker
        and new_board ->> c = marker
    ) into won;
  end if;

  if won then
    expected_winner := actor::text;
    next_actor := null;
    expected_status := 'finished';
  elsif not any_empty then
    expected_winner := 'draw';
    next_actor := null;
    expected_status := 'finished';
  else
    expected_winner := null;
    expected_status := 'active';
  end if;

  if new.state ->> 'winner' is distinct from expected_winner
     or new.state ->> 'turn' is distinct from next_actor
     or new.status <> expected_status then
    raise exception 'The submitted winner, turn or status is invalid';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.wavo2_board_game_guard() from public;
-- Triggers invoke the function internally; client API calls do not need EXECUTE.

drop trigger if exists wavo2_board_game_guard_trigger on public.chat_games;
create trigger wavo2_board_game_guard_trigger
before insert or update on public.chat_games
for each row execute function public.wavo2_board_game_guard();

-- Staging verification required:
-- * Valid creator starts with a blank board and authenticated initial turn.
-- * Valid alternating moves produce expected row states.
-- * Reject fake winners, wrong turn, wrong marker, multiple changes, full column.
-- * Reject insert of pre-filled board and changes to participants/kind.
-- * Verify older mobile/web clients submit the same state format.
-- * Check race conditions under concurrent UPDATE requests.
-- * Confirm rps/coin unaffected and test privileged maintenance workflows.
-- * Re-run security/performance advisors before any production use.
