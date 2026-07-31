import { useEffect, useRef, useState } from "react";
import { CalendarDays, Gamepad2, MessageSquare, MapPin } from "lucide-react";

/**
 * Landing page.
 *
 * The job of this page is narrow: someone's mate has just sent them a link.
 * They have iMessage. They have Snapchat. Why make an account here?
 *
 * The honest answer — and the thing people actually use Wavo for — is that
 * a group chat can't decide anything. So the hero doesn't describe that,
 * it performs it: the chat piles up, then a plan lands and settles it.
 */

// A real Year 8 group chat, which is to say: no conclusion.
const NOISE = [
  { from: "Ish", text: "sleepover sat?" },
  { from: "Miles", text: "who's coming" },
  { from: "Greg", text: "idk" },
  { from: "Miles", text: "wait whose house" },
  { from: "Jack", text: "im maybe" },
  { from: "Ish", text: "so is it on or not" },
];

const STEP_MS = 900;
const HOLD_MS = 2600;

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (e) => setReduced(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

function ChatDemo() {
  const reduced = useReducedMotion();
  // step 0..NOISE.length-1 = messages arriving; NOISE.length = the plan lands
  const [step, setStep] = useState(0);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (reduced) return; // no loop; the render derives the settled state
    let t;
    const tick = () => {
      setStep((s) => {
        const next = s >= NOISE.length ? 0 : s + 1;
        t = setTimeout(tick, next === NOISE.length ? HOLD_MS : STEP_MS);
        return next;
      });
    };
    t = setTimeout(tick, STEP_MS);
    return () => clearTimeout(t);
  }, [reduced]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [step]);

  // Reduced motion: skip straight to the point, no animation loop.
  const settled = reduced || step >= NOISE.length;
  const shown = reduced ? NOISE : NOISE.slice(0, step);

  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-bar">
        <span className="demo-dot" />
        <span className="demo-name">Saturday??</span>
        <span className="demo-count">5 members</span>
      </div>

      <div className="demo-body" ref={bodyRef}>
        {shown.map((m, i) => (
          <div className="demo-msg" key={i}>
            <span className="demo-from">{m.from}</span>
            <span className="demo-bubble">{m.text}</span>
          </div>
        ))}

        {!settled && (
          <div className="demo-msg">
            <span className="demo-from" />
            <span className="demo-bubble demo-typing">
              <i /><i /><i />
            </span>
          </div>
        )}

        {settled && (
          <div className="demo-plan">
            <div className="demo-plan-head">
              <CalendarDays size={13} />
              <strong>Sleepover</strong>
            </div>
            <div className="demo-plan-meta">
              Sat · 7:00 PM · <MapPin size={11} style={{ verticalAlign: "-1px" }} /> Jake's
            </div>
            <div className="demo-plan-btns">
              <span className="demo-rsvp on">Going</span>
              <span className="demo-rsvp">Maybe</span>
              <span className="demo-rsvp">Can't</span>
            </div>
            <div className="demo-plan-going">4 going · Ish, Miles, Greg, Jack</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Landing({ onGetStarted, onLogin }) {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <div className="landing-brand">
          <span className="logo-mark sm">W</span>
          <span>Wavo</span>
        </div>
        <div className="landing-nav-actions">
          <button className="link-btn" onClick={onLogin}>
            Log in
          </button>
          <button className="landing-cta sm" onClick={onGetStarted}>
            Get started
          </button>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-eyebrow">Group chat, but it decides things</p>

          <h1 className="landing-h1">
            Your group chat can't
            <br />
            make a plan.
            <br />
            <span className="landing-h1-accent">Wavo can.</span>
          </h1>

          <p className="landing-sub">
            Forty messages and nobody knows whose house it's at. Wavo turns
            that into one card: who's coming, when, where.
          </p>

          <div className="landing-actions">
            <button className="landing-cta" onClick={onGetStarted}>
              Get started
            </button>
            <button className="landing-ghost" onClick={onLogin}>
              I have an account
            </button>
          </div>

          <p className="landing-note">Free. Takes about a minute.</p>
        </div>

        <ChatDemo />
      </section>

      <section className="landing-things">
        <div className="landing-thing">
          <CalendarDays size={18} />
          <h3>Plans</h3>
          <p>
            Post what's happening. Everyone taps Going, Maybe or Can't. The
            argument ends there.
          </p>
        </div>
        <div className="landing-thing">
          <Gamepad2 size={18} />
          <h3>Games</h3>
          <p>
            Ten of them, built in. Battleship, Connect Four, tic-tac-toe.
            Play a mate in the chat you're already in.
          </p>
        </div>
        <div className="landing-thing">
          <MessageSquare size={18} />
          <h3>Chat</h3>
          <p>
            Groups, DMs, replies, reactions, photos. Themes you unlock by
            actually turning up.
          </p>
        </div>
      </section>

      <footer className="landing-foot">
        <span>Wavo</span>
        <nav className="landing-foot-links">
          <a href="/support.html">Support</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </nav>
        <span>Made in Perth</span>
      </footer>
    </main>
  );
}
