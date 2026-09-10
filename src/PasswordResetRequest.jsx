import { useState } from "react";
import "./password-reset.css";

export function PasswordResetRequest({ onSuccess, onCancel }) {
  const [step, setStep] = useState("email"); // email, check-inbox, loading
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitEmail, setSubmitEmail] = useState("");

  async function handleSubmitEmail(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send reset email");
      }

      setSubmitEmail(email);
      setEmail("");
      setStep("check-inbox");
    } catch (err) {
      console.error("[wavo] password reset request", err);
      setError(err.message || "Could not send reset email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setStep("email");
    setEmail("");
    setError("");
    onCancel?.();
  }

  if (step === "check-inbox") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="reset-icon">📧</div>
          <h2>Check your email</h2>
          <p className="muted">
            We sent a password reset link to <strong>{submitEmail}</strong>
          </p>
          <p className="muted small">
            The link will expire in 1 hour. Don't see it? Check your spam folder.
          </p>
          <button
            className="primary-btn"
            onClick={() => {
              setStep("email");
              setSubmitEmail("");
            }}
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="password-reset-modal">
      <div className="password-reset-card">
        <div className="reset-icon">🔑</div>
        <h2>Reset your password</h2>
        <p className="muted">
          Enter the email address associated with your Wavo account
        </p>

        <form onSubmit={handleSubmitEmail} className="reset-form">
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={busy}
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="primary-btn" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <button className="text-btn" onClick={handleCancel}>
          Back to login
        </button>
      </div>
    </div>
  );
}
