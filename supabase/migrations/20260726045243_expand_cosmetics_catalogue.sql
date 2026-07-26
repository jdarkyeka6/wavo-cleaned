-- Streak unlocks keyed off current_streak vanished the moment you missed a
-- day, even if you'd already hit the milestone. longest_streak is never
-- lower than current_streak, so this only ever grants, never revokes.
update public.cosmetics
   set unlock_rule = jsonb_set(unlock_rule, '{stat}', '"longest_streak"')
 where unlock_type = 'earned'
   and unlock_rule ->> 'stat' = 'current_streak';

-- Every theme id here needs a matching [data-theme="id"] palette in
-- src/styles.css. The DB decides who may wear one; the CSS decides how it
-- looks. Adding a row without a palette gives you an unstyled theme.
insert into public.cosmetics (id, kind, name, description, unlock_type, unlock_rule, min_tier, sort_order, payload) values
  -- ── THEMES · earned ──────────────────────────────────────────────
  ('sherbet','theme','Sherbet','14 day streak','earned','{"stat":"longest_streak","gte":14}',null,12,'{"swatch":"#FDA4AF"}'),
  ('sage','theme','Sage','Open Wavo 30 days','earned','{"stat":"days_active","gte":30}',null,13,'{"swatch":"#86EFAC"}'),
  ('obsidian','theme','Obsidian','Send 1000 messages','earned','{"stat":"messages_sent","gte":1000}',null,14,'{"swatch":"#FAFAFA"}'),
  ('solstice','theme','Solstice','30 day streak','earned','{"stat":"longest_streak","gte":30}',null,15,'{"swatch":"#FCD34D"}'),
  ('eclipse','theme','Eclipse','Open Wavo 100 days','earned','{"stat":"days_active","gte":100}',null,16,'{"swatch":"#818CF8"}'),
  ('everglow','theme','Everglow','365 day streak','earned','{"stat":"longest_streak","gte":365}',null,17,'{"swatch":"linear-gradient(135deg,#F5C56B,#FFF3C4,#E0A94A)"}'),

  -- ── THEMES · premium ─────────────────────────────────────────────
  ('vapor','theme','Vapor','Premium','premium','{}','premium',18,'{"swatch":"#E879F9"}'),
  ('sakura','theme','Sakura','Premium','premium','{}','premium',19,'{"swatch":"#FBCFE8"}'),
  ('carbon','theme','Carbon','Premium','premium','{}','premium',20,'{"swatch":"#F97316"}'),
  ('lagoon','theme','Lagoon','Premium','premium','{}','premium',21,'{"swatch":"#22D3EE"}'),

  -- ── BADGES · earned ──────────────────────────────────────────────
  ('badge_streak14','badge','Committed','14 day streak','earned','{"stat":"longest_streak","gte":14}',null,24,'{"emoji":"📌","color":"#FDA4AF"}'),
  ('badge_streak30','badge','Unstoppable','30 day streak','earned','{"stat":"longest_streak","gte":30}',null,25,'{"emoji":"⚡","color":"#FCD34D"}'),
  ('badge_msg1000','badge','Motormouth','Send 1000 messages','earned','{"stat":"messages_sent","gte":1000}',null,26,'{"emoji":"📢","color":"#818CF8"}'),
  ('badge_days100','badge','Veteran','Open Wavo 100 days','earned','{"stat":"days_active","gte":100}',null,27,'{"emoji":"🏛️","color":"#2DD4BF"}'),
  ('badge_year','badge','Year One','365 day streak','earned','{"stat":"longest_streak","gte":365}',null,28,'{"emoji":"👑","color":"#F5C56B"}'),

  -- ── BADGES · premium ─────────────────────────────────────────────
  ('badge_diamond','badge','Diamond','Premium','premium','{}','premium',29,'{"emoji":"💎","color":"#7DD3FC"}'),
  ('badge_moonlit','badge','Moonlit','Premium','premium','{}','premium',30,'{"emoji":"🌙","color":"#C4B5FD"}'),
  ('badge_clover','badge','Lucky','Premium','premium','{}','premium',31,'{"emoji":"🍀","color":"#86EFAC"}'),

  -- ── NAME STYLES · premium, flat ──────────────────────────────────
  ('name_ice','name_style','Ice name','Premium','premium','{}','premium',34,'{"color":"#7DD3FC"}'),
  ('name_violet','name_style','Violet name','Premium','premium','{}','premium',35,'{"color":"#A78BFA"}'),
  ('name_lime','name_style','Lime name','Premium','premium','{}','premium',36,'{"color":"#A3E635"}'),

  -- ── NAME STYLES · premium, gradient (payload.gradient, see Cosmetic.jsx) ──
  ('name_molten','name_style','Molten name','Premium','premium','{}','premium',37,'{"gradient":"linear-gradient(90deg,#FF8B3D,#FF5C4D,#FFB454,#FF8B3D)"}'),
  ('name_glacier','name_style','Glacier name','Premium','premium','{}','premium',38,'{"gradient":"linear-gradient(90deg,#A5B4FC,#38BDF8,#7DD3FC,#A5B4FC)"}'),
  ('name_prism','name_style','Prism name','Premium','premium','{}','premium',39,'{"gradient":"linear-gradient(90deg,#FF6B5B,#FFB454,#4ADE80,#38BDF8,#A78BFA,#FF6B5B)","animated":true}'),

  -- ── NAME STYLE · the one-year reward ─────────────────────────────
  ('name_everglow','name_style','Everglow name','365 day streak','earned','{"stat":"longest_streak","gte":365}',null,40,'{"gradient":"linear-gradient(90deg,#E0A94A,#FFF3C4,#F5C56B,#FFF3C4,#E0A94A)","animated":true}')
on conflict (id) do update set
  kind        = excluded.kind,
  name        = excluded.name,
  description = excluded.description,
  unlock_type = excluded.unlock_type,
  unlock_rule = excluded.unlock_rule,
  min_tier    = excluded.min_tier,
  sort_order  = excluded.sort_order,
  payload     = excluded.payload;
