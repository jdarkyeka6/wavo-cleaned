import { useCallback, useEffect, useState } from "react";
import { Flame, Snowflake } from "lucide-react";
import { supabase } from "./supabaseClient";

/**
 * The streak, where you can actually see it.
 *
 * It used to live on one line inside Settings → Appearance, so the first you
 * knew about losing a long run was noticing it read 1. This sits in the
 * sidebar and turns amber on a day you haven't counted yet, while there's
 * still time to do something about it.
 *
 * Every value comes from get_streak_state(), including what day it is — the
 * cutoff is a Perth date and the browser's clock may be somewhere else
 * entirely.
 */
export function StreakPill({ userId, refreshKey }) {
  const [state, setState] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.rpc("get_streak_state");
    if (data) setState(data);
  }, [userId]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!live) return;
      await load();
    })();
    return () => {
      live = false;
    };
  }, [load, refreshKey]);

  if (!state) return null;

  const { current_streak: streak, at_risk: atRisk, freezes, hours_left: hoursLeft } =
    state;

  if (!streak) {
    return (
      <div className="streak-pill none" title="Open Wavo tomorrow to start a streak">
        <Flame size={13} />
        <span>Start a streak</span>
      </div>
    );
  }

  const title = atRisk
    ? `${streak} day streak — not counted today yet. ` +
      `About ${hoursLeft}h left${freezes ? `, ${freezes} freeze${freezes === 1 ? "" : "s"} in hand` : ""}.`
    : `${streak} day streak, counted today.` +
      (freezes ? ` ${freezes} freeze${freezes === 1 ? "" : "s"} in hand.` : "");

  return (
    <div className={`streak-pill ${atRisk ? "at-risk" : ""}`} title={title}>
      <Flame size={13} />
      <span>{streak}</span>
      {atRisk && <em>{hoursLeft}h left</em>}
      {freezes > 0 && (
        <span className="streak-freezes" aria-label={`${freezes} streak freezes`}>
          <Snowflake size={11} />
          {freezes}
        </span>
      )}
    </div>
  );
}
