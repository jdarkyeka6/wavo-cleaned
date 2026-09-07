alter table public.support_ai_knowledge
  add column if not exists source text;

alter table public.support_ai_knowledge
  add column if not exists verified_at timestamptz;

comment on column public.support_ai_knowledge.source is
  'Human-readable source used to verify this support fact, such as a GitHub path, live schema, or production deployment.';

comment on column public.support_ai_knowledge.verified_at is
  'When this support fact was last checked against the current Wavo implementation.';
