-- Premium 2 / Pro release hardening.
-- Keep client-facing paid RPCs authenticated-only, keep cron workers private,
-- pin the moderation helper search path, and cover new foreign keys.

alter function public.wavo_text_allowed(text) set search_path = public, pg_temp;

revoke execute on function public.get_or_create_premium_settings() from public, anon;
revoke execute on function public.get_space_pro_stats(uuid) from public, anon;
revoke execute on function public.repair_streak() from public, anon;
revoke execute on function public.schedule_message_v2(text,text,uuid,text,timestamptz,text,integer,integer) from public, anon;
revoke execute on function public.set_group_role(uuid,uuid,text) from public, anon;
revoke execute on function public.my_group_role(uuid) from public, anon;

grant execute on function public.get_or_create_premium_settings() to authenticated;
grant execute on function public.get_space_pro_stats(uuid) to authenticated;
grant execute on function public.repair_streak() to authenticated;
grant execute on function public.schedule_message_v2(text,text,uuid,text,timestamptz,text,integer,integer) to authenticated;
grant execute on function public.set_group_role(uuid,uuid,text) to authenticated;
grant execute on function public.my_group_role(uuid) to authenticated;

-- These are invoked by pg_cron / trusted backend paths, never directly by clients.
revoke execute on function public.deliver_due_messages() from public, anon, authenticated;
revoke execute on function public.deliver_due_space_announcements() from public, anon, authenticated;
revoke execute on function public.refresh_paid_streak_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.strip_lapsed_premium() from public, anon, authenticated;

create index if not exists chat_folder_items_user_id_idx on public.chat_folder_items(user_id);
create index if not exists space_roles_group_id_idx on public.space_roles(group_id);
create index if not exists space_roles_created_by_idx on public.space_roles(created_by);
create index if not exists space_member_roles_user_id_idx on public.space_member_roles(user_id);
create index if not exists space_member_roles_role_id_idx on public.space_member_roles(role_id);
create index if not exists space_scheduled_announcements_group_id_idx on public.space_scheduled_announcements(group_id);
create index if not exists space_scheduled_announcements_created_by_idx on public.space_scheduled_announcements(created_by);
