-- Six light themes, across all three unlock tiers.
--
-- Daylight was the only light theme in a catalogue of twenty-one, and it is a
-- free default. So preferring light mode meant the entire reward system was
-- inert: every streak unlock and every premium theme was dark, and equipping
-- one meant giving up the canvas you actually wanted. Nothing to work towards,
-- nothing worth buying.
--
-- These mirror the tiers that already exist rather than inventing new ones.
-- Meadow sits on the same 7-day milestone as Ember and Blossom on the same
-- 14-day one as Sherbet, so the first two streak rewards now exist on both
-- canvases and the choice is a look rather than a tax.
--
-- Every id here needs a matching [data-theme="id"] palette in src/styles.css
-- AND an entry in the light-theme selector list in that file — the palette
-- decides the colours, the list flips the overlays that assume a dark canvas.
-- A row without both gives you a theme with invisible swatch rings and
-- unreadable voice-note controls.

insert into public.cosmetics (id, kind, name, description, unlock_type, unlock_rule, min_tier, sort_order, payload) values
  -- ── free ─────────────────────────────────────────────────────────
  ('parchment','theme','Parchment','Warm paper.','default','{}',null,22,'{"swatch":"#F6F1E6"}'),
  ('porcelain','theme','Porcelain','Cool and crisp.','default','{}',null,23,'{"swatch":"#EDF1F7"}'),

  -- ── earned ───────────────────────────────────────────────────────
  ('meadow','theme','Meadow','7 day streak','earned','{"stat":"longest_streak","gte":7}',null,24,'{"swatch":"#EDF4EA"}'),
  ('blossom','theme','Blossom','14 day streak','earned','{"stat":"longest_streak","gte":14}',null,25,'{"swatch":"#FBEFF2"}'),

  -- ── premium ──────────────────────────────────────────────────────
  ('linen','theme','Linen','Premium','premium','{}','premium',26,'{"swatch":"#F3F0E9"}'),
  ('arctic','theme','Arctic','Premium','premium','{}','premium',27,'{"swatch":"#EBF5F9"}')
on conflict (id) do update set
  kind        = excluded.kind,
  name        = excluded.name,
  description = excluded.description,
  unlock_type = excluded.unlock_type,
  unlock_rule = excluded.unlock_rule,
  min_tier    = excluded.min_tier,
  sort_order  = excluded.sort_order,
  payload     = excluded.payload;
