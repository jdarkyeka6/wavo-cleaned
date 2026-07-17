import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Cosmetics / stats / streaks.
 *
 * The server owns the truth. This hook only *asks* — it never grants.
 * Unlocking goes through the claim_cosmetic() RPC, which re-checks the
 * requirement against real stats before it writes anything. Nothing here
 * can be lied to from devtools.
 */
export function useCosmetics(userId, tier = "free") {
  // Tier ranking mirrors the DB: free < premium < vip. A user meets an
  // item's requirement when their rank >= the item's required rank.
  const rank = (t) => (t === "vip" ? 3 : t === "premium" ? 2 : 1);
  const isPremium = rank(tier) >= 2;
  // What tier an item needs: explicit min_tier wins, else legacy premium.
  const neededTier = (item) =>
    item.min_tier || (item.unlock_type === "premium" ? "premium" : null);
  const meetsTier = (item) => {
    const need = neededTier(item);
    return need ? rank(tier) >= rank(need) : false;
  };
  const [catalogue, setCatalogue] = useState([]);
  const [unlocked, setUnlocked] = useState(new Set());
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const [cat, mine, st] = await Promise.all([
      supabase.from("cosmetics").select("*").order("sort_order"),
      supabase.from("user_cosmetics").select("cosmetic_id").eq("user_id", userId),
      supabase.from("user_stats").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    setCatalogue(cat.data || []);
    setUnlocked(new Set((mine.data || []).map((r) => r.cosmetic_id)));
    setStats(st.data || null);
    setLoading(false);
  }, [userId]);

  // Count today's visit, then load. touch_activity() is idempotent per day.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      await supabase.rpc("touch_activity");
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, load]);

  /** Ask the server to unlock something. Returns true if it agreed. */
  const claim = useCallback(
    async (cosmeticId) => {
      const { data, error } = await supabase.rpc("claim_cosmetic", {
        p_cosmetic_id: cosmeticId,
      });
      if (error || !data) return false;
      setUnlocked((prev) => new Set(prev).add(cosmeticId));
      return true;
    },
    []
  );

  /**
   * What a locked item needs, and how close you are.
   * Returns null for anything already unlocked or free.
   */
  const requirement = useCallback(
    (item) => {
      if (item.unlock_type === "default") return null;
      if (unlocked.has(item.id)) return null;

      const needReq = neededTier(item);
      if (needReq) {
        // A tier item. Usable when the user's tier is high enough.
        return {
          kind: "premium",
          label: needReq === "vip" ? "VIP" : "Premium",
          needTier: needReq,
          met: meetsTier(item),
        };
      }

      const key = item.unlock_rule?.stat;
      const need = Number(item.unlock_rule?.gte ?? 0);
      const have = Number(stats?.[key] ?? 0);

      return {
        kind: "earned",
        label: item.description,      // e.g. "7 day streak"
        have,
        need,
        met: have >= need,            // met but unclaimed → claimable
      };
    },
    [unlocked, stats]
  );

  const isUsable = useCallback(
    (item) =>
      item.unlock_type === "default" ||
      unlocked.has(item.id) ||
      meetsTier(item),
    [unlocked, tier]
  );

  return { catalogue, unlocked, stats, loading, claim, requirement, isUsable, tier, isPremium, reload: load };
}

/**
 * The cosmetics catalogue: small, public, near-static. Fetched once per page
 * load and shared, rather than every message row hitting the network.
 */
let cataloguePromise = null;

function fetchCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = supabase
      .from("cosmetics")
      .select("id, kind, name, description, payload, unlock_type, unlock_rule, sort_order")
      .order("sort_order")
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((c) => {
          map[c.id] = c;
        });
        return { list: data || [], map };
      });
  }
  return cataloguePromise;
}

export function useCosmeticCatalogue() {
  const [cat, setCat] = useState({ list: [], map: {} });
  useEffect(() => {
    let live = true;
    fetchCatalogue().then((c) => {
      if (live) setCat(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return cat;
}
