drop table if exists public.support_ai_requests;

create table public.support_ai_requests (
  request_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_hash text not null,
  status text not null default 'pending',
  input_chars integer not null default 0 check (input_chars >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  model text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text
);

create index support_ai_requests_user_created_idx on public.support_ai_requests (user_id, created_at desc);
create index support_ai_requests_created_idx on public.support_ai_requests (created_at desc);
create index support_ai_requests_status_created_idx on public.support_ai_requests (status, created_at desc);
create index support_ai_requests_hash_created_idx on public.support_ai_requests (user_id, question_hash, created_at desc);

alter table public.support_ai_requests enable row level security;
revoke all on table public.support_ai_requests from anon, authenticated;

comment on table public.support_ai_requests is 'Server-only rate limiting and accounting for the dedicated /support AI page.';

create or replace function public.support_link(target uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sup uuid := public.support_profile_id();
  cid text;
begin
  if sup is null or target is null or sup = target then return; end if;

  update public.friend_requests
     set status = 'accepted'
   where ((sender_id = sup and receiver_id = target)
       or (sender_id = target and receiver_id = sup))
     and status <> 'accepted';

  if not exists (
    select 1 from public.friend_requests
     where (sender_id = sup and receiver_id = target)
        or (sender_id = target and receiver_id = sup)
  ) then
    insert into public.friend_requests (sender_id, receiver_id, status)
    values (sup, target, 'accepted')
    on conflict (sender_id, receiver_id) do update set status = 'accepted';
  end if;

  cid := case
           when sup::text collate "C" < target::text collate "C"
             then sup::text || '_' || target::text
           else target::text || '_' || sup::text
         end;

  if not exists (
    select 1 from public.messages where chat_id = cid and sender_id = sup
  ) then
    insert into public.messages (chat_id, sender_id, receiver_id, content, type, is_read)
    values (
      cid,
      sup,
      target,
      'Hi, I’m the Wavo human support chat. For instant AI help, use wavo.lol/support. You can still message here when you want a person to review something.',
      'text',
      false
    );
  end if;
end;
$$;

with sup as (
  select id from public.profiles where username = 'support' limit 1
)
update public.messages m
set content = 'Hi, I’m the Wavo human support chat. For instant AI help, use wavo.lol/support. You can still message here when you want a person to review something.'
from sup
where m.sender_id = sup.id
  and m.content in (
    'Hi, I''m the Wavo support chat. We haven''t implemented AI yet, so replies are human-led and may take some time.',
    'Hi, I’m Wavo Support AI. I can help with Wavo accounts, features, bugs, notifications, Premium, safety and troubleshooting. I’ll answer instantly when I can, and a human can still review the chat if needed.'
  );
