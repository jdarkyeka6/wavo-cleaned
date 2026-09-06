import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign } from "lucide-react";
import { supabase } from "./supabaseClient";
import "./username-settings.css";

function findIdentityCard() {
  const heads = [...document.querySelectorAll(".settings-card .settings-head strong")];
  const title = heads.find((node) => node.textContent?.trim() === "Identity");
  return title?.closest(".settings-card") || null;
}

async function readFunctionError(error, fallback) {
  try {
    const response = error?.context;
    if (response?.clone) {
      const payload = await response.clone().json();
      if (payload?.message) return payload.message;
    }
  } catch {}
  return error?.message || fallback;
}

export default function UsernameSettings() {
  const [mount, setMount] = useState(null);
  const [current, setCurrent] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMount(findIdentityCard()));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!mount) return;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const id = sessionData?.session?.user?.id;
      if (!id) return;
      const { data } = await supabase.from("profiles").select("username").eq("id", id).maybeSingle();
      if (!cancelled && data?.username) {
        setCurrent(data.username);
        setUsername(data.username);
      }
    })();
    return () => { cancelled = true; };
  }, [mount]);

  if (!mount) return null;

  async function changeUsername(event) {
    event.preventDefault();
    const next = username.trim().toLowerCase();
    setError("");
    setNote("");

    if (!/^[a-z0-9_]{3,24}$/.test(next)) {
      setError("Use 3–24 lowercase letters, numbers or underscores.");
      return;
    }
    if (next === current.toLowerCase()) {
      setNote("That’s already your username.");
      return;
    }

    const okay = window.confirm(`Change @${current} to @${next}? Your Wavo sign-in username changes too. You can change it again after 7 days.`);
    if (!okay) return;

    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");

      const { data, error: invokeError } = await supabase.functions.invoke("change-username", {
        headers: { Authorization: `Bearer ${token}` },
        body: { username: next },
      });

      if (invokeError) throw new Error(await readFunctionError(invokeError, "Wavo couldn't change that username."));
      if (!data?.ok) throw new Error(data?.message || "Wavo couldn't change that username.");

      setCurrent(data.username || next);
      setUsername(data.username || next);
      setNote(`Username changed to @${data.username || next}. Refreshing Wavo…`);
      window.setTimeout(() => window.location.reload(), 650);
    } catch (err) {
      setError(err?.message || "Wavo couldn't change that username.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="username-settings">
      <div className="username-settings-head">
        <AtSign size={17} />
        <div>
          <strong>Username</strong>
          <span>Your username is also what you use to sign in.</span>
        </div>
      </div>
      <form className="username-settings-form" onSubmit={changeUsername}>
        <div className="username-input-wrap">
          <span>@</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Username"
          />
        </div>
        <button className="secondary-btn" type="submit" disabled={busy || !username.trim()}>
          {busy ? "Changing…" : "Change username"}
        </button>
      </form>
      <span className="username-settings-hint">3–24 letters, numbers or underscores. You can change it once every 7 days.</span>
      {error && <div className="username-settings-error">{error}</div>}
      {note && <div className="username-settings-note">{note}</div>}
    </div>,
    mount,
  );
}
