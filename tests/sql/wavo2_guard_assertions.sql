-- Assumes fixture and the STAGING_ONLY SQL guard were loaded first.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

insert into public.chat_games (id,creator_id,opponent_id,kind,state)
values (
 '11111111-1111-1111-1111-111111111111',
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002',
 'tic_tac_toe',
 jsonb_build_object('board','[null,null,null,null,null,null,null,null,null]'::jsonb,
                    'turn','00000000-0000-0000-0000-000000000001','winner',null)
);

-- Legal opening move.
update public.chat_games
set state = jsonb_build_object(
  'board','["a",null,null,null,null,null,null,null,null]'::jsonb,
  'turn','00000000-0000-0000-0000-000000000002','winner',null
)
where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  rejected boolean := false;
begin
  -- Creator attempting to move again.
  begin
    update public.chat_games
    set state = jsonb_build_object(
      'board','["a","a",null,null,null,null,null,null,null]'::jsonb,
      'turn','00000000-0000-0000-0000-000000000002','winner',null
    )
    where id='11111111-1111-1111-1111-111111111111';
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'Failed to reject wrong turn'; end if;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

-- Legitimate opponent turn.
update public.chat_games
set state=jsonb_build_object(
  'board','["a",null,null,"b",null,null,null,null,null]'::jsonb,
  'turn','00000000-0000-0000-0000-000000000001','winner',null
)
where id='11111111-1111-1111-1111-111111111111';

do $$
declare
  rejected boolean := false;
begin
  -- Try to award a win when no line has been completed.
  begin
    update public.chat_games
    set state=jsonb_build_object(
      'board','["a",null,null,"b","b",null,null,null,null]'::jsonb,
      'turn',null,'winner','00000000-0000-0000-0000-000000000002'
    ),status='finished'
    where id='11111111-1111-1111-1111-111111111111';
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'Fake winner accepted'; end if;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- New connect4 game, followed by one legal drop.
insert into public.chat_games (id,creator_id,opponent_id,kind,state)
values (
 '22222222-2222-2222-2222-222222222222',
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002',
 'connect4',
 jsonb_build_object('board',(select jsonb_agg(null::text) from generate_series(1,42)),
 'turn','00000000-0000-0000-0000-000000000001','winner',null)
);

update public.chat_games
set state=jsonb_build_object(
  'board',jsonb_set(state->'board','{38}','"a"'::jsonb),
  'turn','00000000-0000-0000-0000-000000000002','winner',null)
where id='22222222-2222-2222-2222-222222222222';

do $$
declare
  rejected boolean := false;
begin
  -- Opponent cannot put a floating disc in row 1.
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
  begin
    update public.chat_games
    set state=jsonb_build_object(
      'board',jsonb_set(state->'board','{3}','"b"'::jsonb),
      'turn','00000000-0000-0000-0000-000000000001','winner',null)
    where id='22222222-2222-2222-2222-222222222222';
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'Floating disc accepted'; end if;
end;
$$;

select 'board-game-guard-smoke-passed' as result;
