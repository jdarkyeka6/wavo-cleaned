update public.profiles
set username = 'legacy_helpdesk_disabled',
    banned = true,
    status = 'Support moved to /support',
    last_active = now()
where lower(username) = 'support';
