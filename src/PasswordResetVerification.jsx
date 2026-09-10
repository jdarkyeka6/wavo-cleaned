import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "./supabaseClient";
import "./password-reset.css";

export function PasswordResetVerification({ onSuccess, onError }) {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState("loading"); // loading, reset-form, success, error
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const resetToken = searchParams.get("reset_token");
    if (!resetToken) {
      setError("Invalid or missing reset token");
      setStep("error");
      return;
    }

    setToken(resetToken);
    validateToken(resetToken);
  }, [searchParams]);

  async function validateToken(resetToken) {
    try {
      const response = await fetch("/api/password-reset/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Invalid or expired reset token");
      }

      const data = await response.json();
      setEmail(data.email);
      setStep("reset-form");
    } catch (err) {
      console.error("[wavo] token validation", err);
      setError(err.message || "Failed to validate reset token");
      setStep("error");
      onError?.(err.message);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      setBusy(false);
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      setBusy(false);
      return;
    }

    try {
      // Call backend to reset password
      const response = await fetch("/api/password-reset/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reset password");
      }

      setStep("success");
      onSuccess?.();
    } catch (err) {
      console.error("[wavo] password reset", err);
      setError(err.message || "Failed to reset password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "loading") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="loading">Verifying reset link…</div>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="reset-icon">⚠️</div>
          <h2>Reset link invalid</h2>
          <p className="muted">{error}</p>
          <p className="muted small">
            Reset links expire after 1 hour. Request a new one to continue.
          </p>
          <button
            className="primary-btn"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Return to login
          </button>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="reset-icon">✅</div>
          <h2>Password reset successful</h2>
          <p className="muted">
            Your password has been updated. You can now log in with your new
            password.
          </p>
          <button
            className="primary-btn"
            onClick={() => {
              window.location.href = "/";
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
        <div className="reset-icon">🔐</div>
        <h2>Create new password</h2>
        <p className="muted">
          Reset password for <strong>{email}</strong>
        </p>

        <form onSubmit={handleResetPassword} className="reset-form">
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
              disabled={busy}
              placeholder="At least 6 characters"
            />
          </label>

          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
              disabled={busy}
              placeholder="Re-enter your password"
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="primary-btn" disabled={busy || !newPassword.trim()}>
            {busy ? "Resetting…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
