insert into public.support_ai_knowledge (topic, content, active, source, verified_at)
values (
  'message_encryption',
  'Wavo uses HTTPS/TLS for app-to-backend traffic. The current Wavo client does not implement end-to-end encryption for DMs or Space messages: message text is sent as message content to Supabase and stored server-side. Do not describe Wavo messages as end-to-end encrypted or claim that only the sender and recipient can decrypt them.',
  true,
  'github:src/wavoData.js sendDmMessage/sendSpaceMessage + Supabase project HTTPS URL',
  now()
)
on conflict (topic) do update
set content = excluded.content,
    active = excluded.active,
    source = excluded.source,
    verified_at = excluded.verified_at,
    updated_at = now();

update public.support_ai_knowledge
set content = 'Wavo support is the dedicated /support page. The old human support DM account has been retired. Support AI runs on /support, so while answering inside Support AI never tell the user to go to wavo.lol/support or /support; they are already there. If the knowledge is insufficient, say what is uncertain without referring them back to the same page.',
    source = 'Vercel production + github:supabase/functions/support-ai/index.ts',
    verified_at = now(),
    updated_at = now()
where topic = 'support_entrypoint';
