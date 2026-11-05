import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useLocation, useNavigate } from "react-router-dom";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./lib/config";
import { ageFromBirthDate, validateSignup } from "./lib/signupValidation";
import { supabase } from "./supabaseClient";
import "./auth-signup.css";

// A transient auth client keeps registration from briefly logging the whole app in
// while the confirmation email is being requested.
function registrationClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function friendlyAuthError(error, signup) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login")) return "Incorrect username or password.";
  if (message.includes("already registered") || message.includes("already exists")) return "That account already exists. Try logging in.";
  if (message.includes("password") && message.includes("weak")) return "Choose a stronger password.";
  if (signup && (message.includes("database error") || message.includes("duplicate key") || message.includes("unique"))) {
    return "That username might already be taken. Try a different username.";
  }
  if (message.includes("rate limit")) return "Too many attempts. Try again later.";
  return "Something went wrong. Please try again.";
}

const EMPTY = {
  firstName: "", lastName: "", birthday: "", username: "", email: "",
  password: "", confirmPassword: "", agreed: false,
};

export default function AuthScreen({ onReady }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signup = pathname.replace(/\/+$/, "") === "/signup";
  const [form, setForm] = useState(EMPTY);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const change = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setNotice("");
  };

  const age = ageFromBirthDate(form.birthday);

  async function submit(event) {
    event.preventDefault();
    setErrors({});
    setNotice("");

    if (!signup) {
      const identifier = loginIdentifier.trim().toLowerCase();
      if (!identifier) return setNotice("Enter your Wavo username.");
      setBusy(true);
      try {
        // All existing username-only accounts retain their @wavo.app auth identity.
        const email = identifier.includes("@") ? identifier : `${identifier}@wavo.app`;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
        if (error) throw error;
        onReady?.(data.session);
      } catch (error) {
        setNotice(friendlyAuthError(error, false));
      } finally {
        setBusy(false);
      }
      return;
    }

    const validation = validateSignup(form);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setBusy(true);
    const username = form.username.trim().toLowerCase();
    const email = form.email.trim().toLowerCase();
    const isTestAccount = /^\+test_([a-z0-9_]{3,24})$/i.exec(username);
    const authEmail = `${isTestAccount ? isTestAccount[1] : username}@wavo.app`;

    try {
      const client = registrationClient();
      const { data, error } = await client.auth.signUp({
        email: authEmail,
        password: form.password,
        options: {
          data: {
            username,
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            birthday: form.birthday,
            real_email: email,
            signup_version: "2",
          },
        },
      });
      if (error) throw error;
      if (!data?.user) throw new Error("Account creation failed");

      // The existing recovery endpoint sends a real one-time verification link.
      // Failure here never falsely reports that the email was verified.
      let emailSent = false;
      try {
        if (!data.session) {
          const signedIn = await client.auth.signInWithPassword({ email: authEmail, password: form.password });
          if (signedIn.error) throw signedIn.error;
        }
        const verification = await client.functions.invoke("account-recovery", {
          body: { action: "begin-email-verification", email, currentPassword: form.password },
        });
        if (verification.error || !verification.data?.ok) throw verification.error || new Error("Email delivery unavailable");
        emailSent = true;
      } catch (verificationError) {
        console.warn("[wavo] signup email verification unavailable", verificationError?.message);
      } finally {
        await client.auth.signOut().catch(() => {});
      }

      setForm(EMPTY);
      setLoginIdentifier(username);
      setLoginPassword("");
      navigate("/login");
      setNotice(emailSent
        ? "Account created! Check your email for a verification link. Sign in with your username."
        : "Account created, but the verification email could not be sent. Sign in and use Account security to verify your email.");
    } catch (error) {
      setNotice(friendlyAuthError(error, true));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-orbit auth-orbit-a" />
      <div className="auth-orbit auth-orbit-b" />
      <section className={`auth-card ${signup ? "auth-card-signup" : ""}`}>
        <div className="wavo-mark">W</div>
        <div className="auth-intro">
          <span className="eyebrow">YOUR PEOPLE, TOGETHER</span>
          <h1>{signup ? "Make a Wavo account." : "Welcome back."}</h1>
          <p className="muted">{signup
            ? "Create your account, verify an email for recovery and find your people."
            : "Sign in with your Wavo username and password."}</p>
        </div>

        <form onSubmit={submit} className="stack-form auth-form" noValidate>
          {signup ? (
            <>
              <div className="auth-section-title">About you <span>Private details</span></div>
              <div className="auth-two-column">
                <label>First name
                  <input autoComplete="given-name" value={form.firstName} onChange={(event) => change("firstName", event.target.value)} maxLength={50} required aria-invalid={Boolean(errors.firstName)} placeholder="Your first name" />
                  {errors.firstName && <small className="auth-field-error">{errors.firstName}</small>}
                </label>
                <label>Last name <span className="auth-optional">(optional)</span>
                  <input autoComplete="family-name" value={form.lastName} onChange={(event) => change("lastName", event.target.value)} maxLength={50} placeholder="Optional" aria-invalid={Boolean(errors.lastName)} />
                  {errors.lastName && <small className="auth-field-error">{errors.lastName}</small>}
                </label>
              </div>
              <label>Date of birth
                <input type="date" autoComplete="bday" value={form.birthday} onChange={(event) => change("birthday", event.target.value)} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" required aria-invalid={Boolean(errors.birthday)} />
                {age !== null && age >= 0 && age <= 120 && <small className="auth-hint">Age: {age}. This isn't shown on your public profile.</small>}
                {errors.birthday && <small className="auth-field-error">{errors.birthday}</small>}
              </label>

              <div className="auth-section-title">Your account <span>How friends find you</span></div>
              <label>Username
                <div className="auth-username-field"><span>@</span><input value={form.username} onChange={(event) => change("username", event.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" maxLength={30} placeholder="username" required aria-invalid={Boolean(errors.username)} /></div>
                <small className="auth-hint">3–24 letters, numbers or underscores. For test accounts, use +TEST_name.</small>
                {errors.username && <small className="auth-field-error">{errors.username}</small>}
              </label>
              <label>Email address
                <input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoCapitalize="none" spellCheck={false} placeholder="you@example.com" required aria-invalid={Boolean(errors.email)} />
                <small className="auth-hint">Only for account verification and recovery. Never shown to other users.</small>
                {errors.email && <small className="auth-field-error">{errors.email}</small>}
              </label>
              <label>Password
                <div className="auth-password-field"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(event) => change("password", event.target.value)} minLength={8} placeholder="At least 8 characters" required aria-invalid={Boolean(errors.password)} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div>
                {errors.password && <small className="auth-field-error">{errors.password}</small>}
              </label>
              <label>Confirm password
                <input type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.confirmPassword} onChange={(event) => change("confirmPassword", event.target.value)} required aria-invalid={Boolean(errors.confirmPassword)} placeholder="Repeat your password" />
                {errors.confirmPassword && <small className="auth-field-error">{errors.confirmPassword}</small>}
              </label>
              <label className="auth-agreement">
                <input type="checkbox" checked={form.agreed} onChange={(event) => change("agreed", event.target.checked)} required />
                <span>I agree to Wavo's <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
              </label>
              {errors.agreed && <small className="auth-field-error">{errors.agreed}</small>}
              <p className="auth-age-note">Wavo is designed for ages 8+. Ages 8–12 need verified parent or guardian approval; registration for this age group is not open until that process is ready.</p>
            </>
          ) : (
            <>
              <label>Username
                <input value={loginIdentifier} onChange={(event) => { setLoginIdentifier(event.target.value); setNotice(""); }} autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="Your Wavo username" required />
              </label>
              <label>Password
                <input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => { setLoginPassword(event.target.value); setNotice(""); }} required />
              </label>
            </>
          )}
          {notice && <div className="form-note" role={signup ? "alert" : "status"}>{notice}</div>}
          <button className="primary-btn" disabled={busy} type="submit">{busy ? "Working…" : signup ? "Create my account" : "Enter Wavo"}</button>
        </form>
        <button className="text-btn" onClick={() => { setNotice(""); setErrors({}); navigate(signup ? "/login" : "/signup"); }}>{signup ? "Already have an account? Log in" : "New here? Create an account"}</button>
      </section>
    </main>
  );
}
