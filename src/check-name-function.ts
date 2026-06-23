// Supabase Edge Function: check-name
// Flow: list lookup → if missing, ask DeepSeek → return { ok: true/false }.
// Deploy as a function named "check-name".
//
// Needs one secret set on the SUPABASE project (NOT Vercel):
//   DEEPSEEK_API_KEY = your DeepSeek key
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { name } = await req.json();
    const clean = (name ?? "").toString().trim().toLowerCase();

    if (clean.length < 2) return json({ ok: false, reason: "too short" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1) Is it on the known-names list? (fast, free, certain)
    const { data: hit } = await supabase
      .from("known_names")
      .select("name")
      .eq("name", clean)
      .maybeSingle();
    if (hit) return json({ ok: true, source: "list" });

    // 2) Not on the list → ask DeepSeek (the final step)
    const key = Deno.env.get("DEEPSEEK_API_KEY");
    if (!key) return json({ ok: true, source: "ai-skipped" }); // fail-open

    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 8,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You decide whether a submitted word is a plausible real human name " +
              "(a first or last name from any culture) or just random keyboard " +
              "gibberish. Reply with ONLY one word: REAL or FAKE.",
          },
          { role: "user", content: clean },
        ],
      }),
    });

    const data = await resp.json();
    const verdict = (data?.choices?.[0]?.message?.content ?? "").toUpperCase();
    // fail-open: only reject if DeepSeek clearly says FAKE
    const ok = !verdict.includes("FAKE");
    return json({ ok, source: "ai", verdict });
  } catch (e) {
    // never block all sign-ups because of a hiccup
    return json({ ok: true, source: "error", error: String(e) });
  }
});
