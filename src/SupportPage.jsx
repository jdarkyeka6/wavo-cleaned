import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Send, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "./supabaseClient";
import "./support-page.css";

const welcome = {
  role: "assistant",
  content: "Hi, I’m Wavo Support AI. Ask me about Wavo accounts, features, bugs, notifications, Premium, safety, or troubleshooting. If I’m not sure, I’ll tell you instead of making something up.",
};

export default function SupportPage() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState([welcome]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data?.session || null);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener?.subscription?.unsubscribe();
  }, []);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, sending]);

  const send = async (event) => {
    event?.preventDefault();
    const question = text.trim();
    if (!question || sending || !session) return;

    const userMessage = { role: "user", content: question };
    const priorHistory = messages.slice(-8);
    setMessages((current) => [...current, userMessage]);
    setText("");
    setSending(true);

    try {
      const { data, error } = await supabase.functions.invoke("support-ai", {
        body: {
          requestId: crypto.randomUUID(),
          question,
          history: priorHistory,
        },
      });

      if (error) throw error;
      if (!data?.reply) throw new Error(data?.message || "No response returned");
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
    } catch (error) {
      console.error("[wavo support]", error);
      setMessages((current) => [...current, {
        role: "assistant",
        error: true,
        content: "I couldn’t answer that right now. Try again in a moment, or message the support account in Wavo for human help.",
      }]);
    } finally {
      setSending(false);
    }
  };

  if (!ready) return <div className="support-shell"><div className="support-loading">Opening Wavo Support…</div></div>;

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
    <main className="support-shell">
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

      <section className="support-body">
        <div className="support-thread">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`support-row ${message.role === "user" ? "is-user" : "is-ai"}`}>
              <div className="support-avatar">{message.role === "user" ? <UserRound size={17} /> : <Bot size={17} />}</div>
              <div className={`support-bubble ${message.error ? "is-error" : ""}`}>{message.content}</div>
            </div>
          ))}
          {sending && (
            <div className="support-row is-ai">
              <div className="support-avatar"><Bot size={17} /></div>
              <div className="support-bubble support-thinking"><i></i><i></i><i></i></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </section>

      <footer className="support-compose-wrap">
        <form className="support-compose" onSubmit={send}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 2000))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(event);
              }
            }}
            placeholder="Ask Wavo Support…"
            rows={1}
            disabled={sending}
          />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send"><Send size={19} /></button>
        </form>
        <div className="support-footnote">AI can make mistakes. For account actions or anything sensitive, use the human support account in Wavo.</div>
      </footer>
    </main>
  );
}
