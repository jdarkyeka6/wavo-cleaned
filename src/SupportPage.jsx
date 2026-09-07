import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Plus, Send, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { supabase } from "./supabaseClient";
import "./support-page.css";

const MAX_TABS = 8;
const STORAGE_VERSION = 1;

const welcome = {
  role: "assistant",
  content: "Hi, I’m Wavo Support AI. Ask me about Wavo accounts, features, bugs, notifications, Premium, safety, or troubleshooting. If I’m not sure, I’ll tell you instead of making something up.",
};

const freshMessages = () => [{ ...welcome }];

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `support-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeTab() {
  return {
    id: randomId(),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: freshMessages(),
  };
}

function cleanStoredTabs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_TABS)
    .map((tab) => ({
      id: typeof tab?.id === "string" && tab.id ? tab.id : randomId(),
      title: typeof tab?.title === "string" && tab.title.trim() ? tab.title.slice(0, 42) : "Support chat",
      createdAt: Number(tab?.createdAt) || Date.now(),
      updatedAt: Number(tab?.updatedAt) || Date.now(),
      messages: Array.isArray(tab?.messages) && tab.messages.length
        ? tab.messages
            .filter((message) => message && (message.role === "user" || message.role === "assistant"))
            .slice(-80)
            .map((message) => ({
              role: message.role,
              content: String(message.content || "").slice(0, 8000),
              ...(message.error ? { error: true } : {}),
            }))
        : freshMessages(),
    }));
}

function titleFromQuestion(question) {
  const compact = question.replace(/\s+/g, " ").trim();
  if (!compact) return "Support chat";
  return compact.length > 34 ? `${compact.slice(0, 34).trim()}…` : compact;
}

export default function SupportPage() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [tabs, setTabs] = useState(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [historyLoadedFor, setHistoryLoadedFor] = useState(null);
  const [text, setText] = useState("");
  const [sendingTabId, setSendingTabId] = useState(null);
  const [wipeArmed, setWipeArmed] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId],
  );
  const messages = activeTab?.messages || freshMessages();
  const sending = sendingTabId === activeTab?.id;

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session || null);
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next || null);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || historyLoadedFor === userId) return;

    const key = `wavo-support-tabs:v${STORAGE_VERSION}:${userId}`;
    let restored = [];
    try {
      const raw = localStorage.getItem(key);
      restored = raw ? cleanStoredTabs(JSON.parse(raw)) : [];
    } catch (error) {
      console.warn("[wavo support] could not restore local support history", error);
    }

    const nextTabs = restored.length ? restored : [makeTab()];
    setTabs(nextTabs);
    setActiveTabId(nextTabs[0].id);
    setHistoryLoadedFor(userId);
    setText("");
    setWipeArmed(false);
  }, [session?.user?.id, historyLoadedFor]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || historyLoadedFor !== userId) return;
    try {
      localStorage.setItem(
        `wavo-support-tabs:v${STORAGE_VERSION}:${userId}`,
        JSON.stringify(tabs),
      );
    } catch (error) {
      console.warn("[wavo support] could not save local support history", error);
    }
  }, [tabs, session?.user?.id, historyLoadedFor]);

  useEffect(() => {
    if (!activeTabId && tabs[0]?.id) setActiveTabId(tabs[0].id);
  }, [activeTabId, tabs]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const frame = requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [activeTabId, messages.length, sending]);

  const updateTab = (tabId, updater) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  };

  const createTab = () => {
    if (tabs.length >= MAX_TABS) return;
    const next = makeTab();
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
    setText("");
    setWipeArmed(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const switchTab = (tabId) => {
    setActiveTabId(tabId);
    setText("");
    setWipeArmed(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const wipeHistory = () => {
    if (!activeTab) return;
    if (!wipeArmed) {
      setWipeArmed(true);
      window.setTimeout(() => setWipeArmed(false), 3500);
      return;
    }

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      title: "New chat",
      updatedAt: Date.now(),
      messages: freshMessages(),
    }));
    setText("");
    setWipeArmed(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = async () => {
    const question = text.trim();
    const targetTab = activeTab;
    if (!question || !targetTab || sendingTabId || !session?.access_token) return;

    const tabId = targetTab.id;
    const userMessage = { role: "user", content: question };
    const priorHistory = targetTab.messages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    updateTab(tabId, (tab) => ({
      ...tab,
      title: tab.title === "New chat" ? titleFromQuestion(question) : tab.title,
      updatedAt: Date.now(),
      messages: [...tab.messages, userMessage],
    }));
    setText("");
    setSendingTabId(tabId);

    try {
      const { data, error } = await supabase.functions.invoke("support-ai", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          requestId: randomId(),
          question,
          history: priorHistory,
        },
      });

      if (error) throw error;
      if (!data?.reply) throw new Error(data?.message || "No response returned");

      updateTab(tabId, (tab) => ({
        ...tab,
        updatedAt: Date.now(),
        messages: [
          ...tab.messages,
          { role: "assistant", content: String(data.reply) },
        ],
      }));
    } catch (error) {
      console.error("[wavo support]", error);
      updateTab(tabId, (tab) => ({
        ...tab,
        updatedAt: Date.now(),
        messages: [
          ...tab.messages,
          {
            role: "assistant",
            error: true,
            content: "I couldn’t answer that right now. Try again in a moment.",
          },
        ],
      }));
    } finally {
      setSendingTabId(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (!ready) {
    return (
      <div className="support-shell support-centered">
        <div className="support-loading">Opening Wavo Support…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="support-shell support-centered">
        <div className="support-login-card">
          <div className="support-mark"><Bot size={28} /></div>
          <h1>Wavo Support</h1>
          <p>Sign in to use AI support. This keeps the support system protected from spam and lets Wavo apply fair usage limits.</p>
          <a className="support-primary" href="/">Back to Wavo</a>
        </div>
      </div>
    );
  }

  return (
    <main className="support-shell" data-support-page="ai">
      <header className="support-topbar">
        <a href="/" className="support-back" aria-label="Back to Wavo"><ArrowLeft size={20} /></a>
        <div className="support-title-row">
          <div className="support-mark"><Bot size={20} /></div>
          <div>
            <strong>Wavo Support</strong>
            <span>AI help · usually instant</span>
          </div>
        </div>
        <div className="support-safe"><ShieldCheck size={16} /> protected</div>
      </header>

      <nav className="support-tabbar" aria-label="Support conversations">
        <div className="support-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab?.id}
              className={`support-tab ${tab.id === activeTab?.id ? "is-active" : ""}`}
              onClick={() => switchTab(tab.id)}
              title={tab.title}
            >
              <span>{tab.title}</span>
              {sendingTabId === tab.id && <i className="support-tab-dot" aria-label="Replying" />}
            </button>
          ))}
          <button
            type="button"
            className="support-new-tab"
            onClick={createTab}
            disabled={tabs.length >= MAX_TABS}
            aria-label={tabs.length >= MAX_TABS ? `Maximum ${MAX_TABS} support tabs` : "New support tab"}
            title={tabs.length >= MAX_TABS ? `Maximum ${MAX_TABS} support tabs` : "New support tab"}
          >
            <Plus size={16} /> <span>New</span>
          </button>
        </div>
        <button
          type="button"
          className={`support-wipe ${wipeArmed ? "is-armed" : ""}`}
          onClick={wipeHistory}
          disabled={!activeTab || sending}
          title="Clear this support tab"
        >
          <Trash2 size={15} />
          <span>{wipeArmed ? "Tap again to wipe" : "Wipe history"}</span>
        </button>
      </nav>

      <section className="support-body" ref={bodyRef} aria-live="polite">
        <div className="support-thread">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`support-row ${message.role === "user" ? "is-user" : "is-ai"}`}
            >
              <div className="support-avatar">
                {message.role === "user" ? <UserRound size={17} /> : <Bot size={17} />}
              </div>
              <div className={`support-bubble ${message.error ? "is-error" : ""}`}>
                {message.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="support-row is-ai">
              <div className="support-avatar"><Bot size={17} /></div>
              <div className="support-bubble support-thinking" aria-label="Wavo Support AI is thinking">
                <i></i><i></i><i></i>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="support-compose-wrap">
        <div className="support-compose" role="group" aria-label="Ask Wavo Support">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 2000))}
            onKeyDown={handleKeyDown}
            placeholder="Ask Wavo Support…"
            rows={1}
            disabled={Boolean(sendingTabId)}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!text.trim() || Boolean(sendingTabId)}
            aria-label="Send"
          >
            <Send size={19} />
          </button>
        </div>
        <div className="support-footnote">
          Support tabs are saved on this device. AI can make mistakes, so uncertain answers should say so instead of inventing steps.
        </div>
      </footer>
    </main>
  );
}
