import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Gamepad2,
  Headphones,
  Image as ImageIcon,
  MessageCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { getUxPrefs, updateUxPrefs } from "./offline";
import { CORE_FEATURES, DEFAULT_CORE_FEATURES, getCoreFeature, normalizeCoreFeatures } from "./coreFeatures";
import "./personalized-core.css";

const ICONS = {
  messages: MessageCircle,
  hop_in: Headphones,
  waves: Sparkles,
  photos: ImageIcon,
  plans: CalendarDays,
  spaces: Users,
  games: Gamepad2,
  search: Search,
  create: Plus,
  profile: User,
};

function coreForUser(userId) {
  if (!userId) return DEFAULT_CORE_FEATURES;
  const selected = normalizeCoreFeatures(getUxPrefs(userId).coreFeatures);
  return selected.length ? selected : DEFAULT_CORE_FEATURES;
}

function clickNav(label) {
  const button = [...document.querySelectorAll(".bottom-nav button")].find((node) => node.textContent?.trim().toLowerCase() === label.toLowerCase());
  button?.click();
}

function clickButtonContaining(selector, label) {
  const target = [...document.querySelectorAll(selector)].find((node) => node.textContent?.trim().toLowerCase().includes(label.toLowerCase()));
  target?.click();
  return Boolean(target);
}

function scrollToHomeSection(title) {
  const heading = [...document.querySelectorAll(".home-screen .section-heading h2")].find((node) => node.textContent?.trim().toLowerCase() === title.toLowerCase());
  heading?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openTogetherTab(label) {
  const launcher = document.querySelector(".wt-launcher");
  launcher?.click();
  window.setTimeout(() => {
    clickButtonContaining(".wt-tabs button", label);
  }, 60);
}

function launchFeature(id) {
  if (id === "messages") return clickNav("Inbox");
  if (id === "spaces") return clickNav("Spaces");
  if (id === "profile") return clickNav("You");
  if (id === "search") return document.querySelector(".mobile-search-trigger")?.click();
  if (id === "create") return document.querySelector(".nav-create")?.click();
  if (id === "plans") return scrollToHomeSection("Plans");
  if (id === "hop_in") return openTogetherTab("Hangout");
  if (id === "games") return openTogetherTab("Play");
  if (id === "waves" || id === "photos") window.location.assign("/waves");
}

function inferFeatureFromClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return null;
  if (target.closest(".personalized-core")) return null;
  const button = target.closest("button");
  const text = button?.textContent?.trim().toLowerCase() || "";
  if (button?.closest(".bottom-nav")) {
    if (text === "inbox") return "messages";
    if (text === "spaces") return "spaces";
    if (text === "you") return "profile";
    if (button.classList.contains("nav-create")) return "create";
  }
  if (target.closest(".mobile-search-trigger")) return "search";
  if (target.closest(".wt-launcher")) return "hop_in";
  if (button?.closest(".wt-tabs") && text.includes("hangout")) return "hop_in";
  if (button?.closest(".wt-tabs") && text.includes("play")) return "games";
  if (text.includes("new plan") || text.includes("create a plan")) return "plans";
  if (text.includes("send wave") || text.includes("wave")) return "waves";
  return null;
}

function CoreEditor({ selected, onClose, onSave }) {
  const [draft, setDraft] = useState(selected);

  function toggle(id) {
    setDraft((current) => {
      if (current.includes(id)) return current.length <= 3 ? current : current.filter((item) => item !== id);
      if (current.length >= 6) return current;
      return [...current, id];
    });
  }

  function move(id, direction) {
    setDraft((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  return (
    <div className="core-editor-layer" role="dialog" aria-modal="true" aria-label="Customize your Wavo Core">
      <section className="core-editor-sheet">
        <header><div><span className="eyebrow">YOUR WAVO</span><h2>Customize Core</h2><p>Pick 3–6 things. Wavo will never move them by itself.</p></div><button className="core-close" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <div className="core-editor-order">
          {draft.map((id, index) => {
            const feature = getCoreFeature(id);
            if (!feature) return null;
            return <div key={id}><span>{feature.emoji}</span><strong>{feature.label}</strong><div><button onClick={() => move(id, -1)} disabled={index === 0} aria-label={`Move ${feature.label} up`}>↑</button><button onClick={() => move(id, 1)} disabled={index === draft.length - 1} aria-label={`Move ${feature.label} down`}>↓</button></div></div>;
          })}
        </div>
        <div className="core-editor-grid">
          {CORE_FEATURES.map((feature) => {
            const active = draft.includes(feature.id);
            return <button key={feature.id} className={active ? "selected" : ""} onClick={() => toggle(feature.id)} aria-pressed={active}><span>{feature.emoji}</span><div><strong>{feature.label}</strong><small>{feature.hint}</small></div><b>{active ? "✓" : "+"}</b></button>;
          })}
        </div>
        <footer><span>{draft.length}/6 in Core</span><button className="primary-btn" onClick={() => onSave(draft)}>Save Core</button></footer>
      </section>
    </div>
  );
}

export default function PersonalizedCore() {
  const [userId, setUserId] = useState(null);
  const [host, setHost] = useState(null);
  const [core, setCore] = useState(DEFAULT_CORE_FEATURES);
  const [usage, setUsage] = useState({});
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUserId(data?.session?.user?.id || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user?.id || null));
    return () => { alive = false; listener?.subscription?.unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const prefs = getUxPrefs(userId);
    setCore(coreForUser(userId));
    setUsage(prefs.coreUsage || {});
    const sync = () => {
      const next = getUxPrefs(userId);
      setCore(coreForUser(userId));
      setUsage(next.coreUsage || {});
    };
    window.addEventListener("wavo:core-updated", sync);
    return () => window.removeEventListener("wavo:core-updated", sync);
  }, [userId]);

  useEffect(() => {
    function attach() {
      const home = document.querySelector(".home-screen");
      if (!home) { setHost(null); return; }
      let nextHost = home.querySelector(":scope > .personalized-core-host");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.className = "personalized-core-host";
        const hero = home.querySelector(":scope > .hero-card");
        if (hero?.nextSibling) home.insertBefore(nextHost, hero.nextSibling);
        else home.prepend(nextHost);
      }
      setHost(nextHost);
    }
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const onClick = (event) => {
      const id = inferFeatureFromClick(event);
      if (!id) return;
      const prefs = getUxPrefs(userId);
      const currentUsage = prefs.coreUsage || {};
      const previous = currentUsage[id] || { count: 0, lastUsed: 0 };
      const nextUsage = { ...currentUsage, [id]: { count: Number(previous.count || 0) + 1, lastUsed: Date.now() } };
      updateUxPrefs(userId, { coreUsage: nextUsage });
      setUsage(nextUsage);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [userId]);

  const suggestions = useMemo(() => {
    return CORE_FEATURES
      .filter((feature) => !core.includes(feature.id))
      .map((feature) => ({ feature, score: Number(usage?.[feature.id]?.count || 0), lastUsed: Number(usage?.[feature.id]?.lastUsed || 0) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed)
      .slice(0, 2);
  }, [core, usage]);

  function rememberCoreUse(id) {
    if (!userId) return;
    const prefs = getUxPrefs(userId);
    const currentUsage = prefs.coreUsage || {};
    const previous = currentUsage[id] || { count: 0, lastUsed: 0 };
    const nextUsage = { ...currentUsage, [id]: { count: Number(previous.count || 0) + 1, lastUsed: Date.now() } };
    updateUxPrefs(userId, { coreUsage: nextUsage });
    setUsage(nextUsage);
  }

  function openFeature(id) {
    rememberCoreUse(id);
    launchFeature(id);
  }

  function save(next) {
    if (!userId) return;
    const normalized = normalizeCoreFeatures(next);
    if (normalized.length < 3) return;
    updateUxPrefs(userId, { coreFeatures: normalized, coreSetupVersion: 1 });
    setCore(normalized);
    setEditing(false);
    window.dispatchEvent(new CustomEvent("wavo:core-updated", { detail: { userId } }));
  }

  function addSuggested(id) {
    if (core.includes(id)) return;
    if (core.length >= 6) return setEditing(true);
    save([...core, id]);
  }

  if (!host || !userId) return editing ? <CoreEditor selected={core} onClose={() => setEditing(false)} onSave={save} /> : null;

  const content = (
    <section className="personalized-core">
      <div className="personalized-core-head"><div><span className="eyebrow">YOUR CORE</span><h2>Wavo, your way.</h2></div><button onClick={() => setEditing(true)}><SlidersHorizontal size={16} /> Edit</button></div>
      <div className="personalized-core-grid">
        {core.map((id) => {
          const feature = getCoreFeature(id);
          if (!feature) return null;
          const Icon = ICONS[id] || Sparkles;
          return <button key={id} onClick={() => openFeature(id)}><span className="core-icon"><Icon size={21} /></span><div><strong>{feature.label}</strong><small>{feature.hint}</small></div></button>;
        })}
      </div>
      {suggestions.length > 0 && <div className="core-suggestions"><div><span className="eyebrow">FOR YOU</span><small>Wavo noticed these, but nothing moves unless you say so.</small></div>{suggestions.map(({ feature }) => <button key={feature.id} onClick={() => addSuggested(feature.id)}><span>{feature.emoji}</span><div><strong>{feature.label}</strong><small>Add to Core</small></div><b>＋</b></button>)}</div>}
      <div className="core-scroll-cue"><span>Keep scrolling for everything else</span><i>↓</i></div>
    </section>
  );

  return <>{createPortal(content, host)}{editing && <CoreEditor selected={core} onClose={() => setEditing(false)} onSave={save} />}</>;
}
