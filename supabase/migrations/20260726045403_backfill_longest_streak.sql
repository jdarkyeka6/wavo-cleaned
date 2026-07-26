-- Some rows predate longest_streak being maintained and hold a value below
-- current_streak. Now that unlocks key off longest_streak, that would
-- under-report people's real progress. Strictly raises, never lowers.
update public.user_stats
   set longest_streak = greatest(longest_streak, current_streak, 0),
       updated_at = now()
 where longest_streak < greatest(current_streak, 0);
