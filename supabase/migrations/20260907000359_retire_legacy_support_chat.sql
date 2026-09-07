do $$
declare
  sup uuid;
begin
  select id into sup from public.profiles where lower(username) = 'support' limit 1;

  drop trigger if exists on_profile_support_link on public.profiles;

  if sup is not null then
    delete from public.messages
      where sender_id = sup or receiver_id = sup;

    delete from public.friend_requests
      where sender_id = sup or receiver_id = sup;
  end if;
end;
$$;

drop function if exists public.support_link_on_signup();
drop function if exists public.support_link(uuid);
drop function if exists public.support_profile_id();

update public.support_ai_knowledge
set content = 'Wavo support now lives at /support. The old human support DM account has been retired and should not be used or suggested. If the AI is uncertain, it should say it does not know rather than inventing steps.',
    updated_at = now()
where topic = 'product';
