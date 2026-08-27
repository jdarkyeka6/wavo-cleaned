-- Remove an iOS APNs token from the currently authenticated account on logout.
--
-- This mirrors claim_ios_push_subscription(): the client can only release the
-- exact token it presents, and the DELETE is additionally scoped to auth.uid().
-- A signed-in user therefore cannot remove another account's subscriptions.
create or replace function public.release_ios_push_subscription(
  p_device_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if length(btrim(coalesce(p_device_token, ''))) = 0 then
    return false;
  end if;

  delete from public.push_subscriptions
  where user_id = auth.uid()
    and platform = 'ios'
    and device_token = btrim(p_device_token);

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.release_ios_push_subscription(text) from public;
grant execute on function public.release_ios_push_subscription(text) to authenticated;
