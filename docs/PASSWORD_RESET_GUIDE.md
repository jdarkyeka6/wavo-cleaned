# Password Reset with Email Verification Implementation Guide

## Overview
This guide walks you through implementing a complete password reset flow with email verification using Resend for email delivery and Supabase for backend authentication.

## Architecture

```
User Flow:
1. Forgot Password → Request Link
2. Email Sent via Resend
3. Click Link in Email
4. Verify Token
5. Reset Password
6. Success
```

## Components & Files

### 1. **ForgotPasswordRequest.jsx** - Request Reset Link
- User enters email
- Backend generates reset token
- Resend sends email with link
- Show confirmation message

### 2. **PasswordResetVerification.jsx** - Verify & Reset
- Validates reset token from URL
- Form to enter new password
- Updates password in Supabase
- Shows success/error states

### 3. **Backend API Routes** (Node.js/Express)
- `/api/password-reset/request` - Generate & send reset email
- `/api/password-reset/validate` - Verify token validity
- `/api/password-reset/reset` - Update password

### 4. **Styling** - password-reset.css
- Modal overlay
- Form inputs & buttons
- Error/success states
- Responsive design

---

## Step-by-Step Implementation

### Step 1: Install Dependencies

```bash
npm install resend dotenv
```

### Step 2: Set Up Environment Variables

Add to your `.env.local`:

```env
# Resend
VITE_RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...  # For backend only!

# App Config
VITE_APP_URL=http://localhost:5173
RESET_TOKEN_EXPIRES_IN=3600  # 1 hour in seconds
```

### Step 3: Create Backend Routes

#### File: `server/routes/passwordReset.js`

```javascript
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const router = express.Router();

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Store reset tokens in memory (use Redis in production!)
const resetTokens = new Map();

// 1. REQUEST PASSWORD RESET
router.post("/request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", email.toLowerCase())
      .single();

    if (userError || !user) {
      // Don't reveal if email exists (security)
      return res.status(200).json({
        message: "If that email exists, a reset link has been sent",
      });
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 3600000; // 1 hour

    // Store token
    resetTokens.set(token, {
      userId: user.id,
      email: user.email,
      expiresAt,
    });

    // Build reset link
    const resetLink = `${process.env.VITE_APP_URL}/reset-password?reset_token=${token}`;

    // Send email
    const emailResponse = await resend.emails.send({
      from: "noreply@wavo.lol",
      to: user.email,
      subject: "Reset Your Wavo Password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2>Reset Your Password</h2>
          <p>We received a request to reset your password. Click the link below:</p>
          
          <a href="${resetLink}" style="
            display: inline-block;
            background: #007AFF;
            color: white;
            padding: 12px 30px;
            border-radius: 6px;
            text-decoration: none;
            margin: 20px 0;
          ">Reset Password</a>
          
          <p style="color: #666; font-size: 14px;">
            Or copy this link: ${resetLink}
          </p>
          
          <p style="color: #999; font-size: 12px;">
            This link expires in 1 hour.
            If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    });

    if (emailResponse.error) {
      console.error("[wavo] Resend error:", emailResponse.error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.status(200).json({
      message: "Reset link sent to your email",
      token: token, // Dev only - remove in production
    });
  } catch (error) {
    console.error("[wavo] Password reset request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. VALIDATE TOKEN
router.post("/validate", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const tokenData = resetTokens.get(token);

    if (!tokenData) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (tokenData.expiresAt < Date.now()) {
      resetTokens.delete(token);
      return res.status(401).json({ error: "Token expired" });
    }

    res.status(200).json({
      email: tokenData.email,
      message: "Token is valid",
    });
  } catch (error) {
    console.error("[wavo] Token validation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. RESET PASSWORD
router.post("/reset", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ error: "Token and password are required" });
    }

    const tokenData = resetTokens.get(token);

    if (!tokenData) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (tokenData.expiresAt < Date.now()) {
      resetTokens.delete(token);
      return res.status(401).json({ error: "Token expired" });
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      tokenData.userId,
      { password: newPassword }
    );

    if (updateError) {
      console.error("[wavo] Update password error:", updateError);
      return res.status(500).json({ error: "Failed to update password" });
    }

    // Invalidate token
    resetTokens.delete(token);

    // Log password change
    await supabase.from("audit_logs").insert({
      user_id: tokenData.userId,
      action: "password_reset",
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("[wavo] Password reset error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

### Step 4: Register Routes in Express

```javascript
// server/index.js
import passwordResetRoutes from "./routes/passwordReset.js";

app.use("/api/password-reset", passwordResetRoutes);
```

### Step 5: Create Frontend Components

Already created: `src/PasswordResetVerification.jsx`

#### Now create: `src/ForgotPasswordRequest.jsx`

```javascript
import { useState } from "react";
import "./password-reset.css";

export function ForgotPasswordRequest({ onClose }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("request"); // request, sent, error
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleRequestReset(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send reset email");
      }

      setStep("sent");
    } catch (err) {
      console.error("[wavo] reset request", err);
      setError(err.message);
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  if (step === "sent") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="reset-icon">✉️</div>
          <h2>Check your email</h2>
          <p className="muted">
            We've sent a password reset link to <strong>{email}</strong>
          </p>
          <p className="muted small">
            Link expires in 1 hour. Check spam folder if you don't see it.
          </p>
          <button className="primary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="password-reset-modal">
        <div className="password-reset-card">
          <div className="reset-icon">⚠️</div>
          <h2>Something went wrong</h2>
          <p className="muted">{error}</p>
          <button
            className="primary-btn"
            onClick={() => {
              setStep("request");
              setError("");
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="password-reset-modal">
      <div className="password-reset-card">
        <div className="reset-icon">🔑</div>
        <h2>Reset password</h2>
        <p className="muted">Enter your email to receive a reset link</p>

        <form onSubmit={handleRequestReset} className="reset-form">
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
              placeholder="your@email.com"
            />
          </label>

          <button className="primary-btn" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send reset link"}
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
```

### Step 6: Add Styling

Create `src/password-reset.css`:

```css
.password-reset-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.password-reset-card {
  background: white;
  border-radius: 12px;
  padding: 40px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.reset-icon {
  font-size: 48px;
  text-align: center;
  margin-bottom: 20px;
}

.password-reset-card h2 {
  font-size: 24px;
  margin: 0 0 8px 0;
  color: #000;
  text-align: center;
}

.password-reset-card .muted {
  color: #666;
  font-size: 14px;
  text-align: center;
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.password-reset-card .muted.small {
  font-size: 12px;
  color: #999;
}

.reset-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

.reset-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-weight: 500;
  color: #333;
}

.reset-form input {
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s;
}

.reset-form input:focus {
  outline: none;
  border-color: #007aff;
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
}

.reset-form input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.form-error {
  color: #ff3b30;
  font-size: 13px;
  padding: 10px 12px;
  background: #fff5f5;
  border-radius: 6px;
  border-left: 3px solid #ff3b30;
}

.loading {
  text-align: center;
  color: #666;
  font-size: 14px;
  padding: 40px 20px;
}

.primary-btn,
.secondary-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn {
  background: #007aff;
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background: #0051d5;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  background: #f2f2f7;
  color: #007aff;
}

.secondary-btn:hover:not(:disabled) {
  background: #e5e5ea;
}

@media (max-width: 600px) {
  .password-reset-card {
    padding: 30px 20px;
  }

  .password-reset-card h2 {
    font-size: 20px;
  }
}
```

### Step 7: Add Routes to App.jsx

```javascript
import { PasswordResetVerification } from "./PasswordResetVerification";

// In your router config:
<Route
  path="/reset-password"
  element={<PasswordResetVerification />}
/>
```

### Step 8: Add Forgot Password Link to Login

```javascript
// In your login component
import { ForgotPasswordRequest } from "./ForgotPasswordRequest";
import { useState } from "react";

function Login() {
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  return (
    <form>
      {/* email input, password input, etc */}
      
      <button type="button" 
        onClick={() => setShowForgotPassword(true)}
        className="forgot-password-link"
      >
        Forgot password?
      </button>

      {showForgotPassword && (
        <ForgotPasswordRequest 
          onClose={() => setShowForgotPassword(false)} 
        />
      )}
    </form>
  );
}
```

---

## Database Schema

### Audit Logs Table (Optional but recommended)

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT now()
);
```

---

## Security Best Practices

✅ **What we're doing right:**
- Tokens expire after 1 hour
- Tokens are random 32-byte hex strings
- Password hash stored securely in Supabase
- Email not revealed if account doesn't exist
- HTTPS only in production
- Rate limiting recommended on `/request` endpoint

⚠️ **Additional measures for production:**
- Use Redis instead of in-memory Map for tokens
- Add rate limiting (e.g., 3 requests per hour per IP)
- Log all password reset attempts
- Add CSRF tokens to forms
- Use Supabase RLS policies
- Send from verified Resend domain

---

## Testing Checklist

- [ ] Request reset link with valid email
- [ ] Request reset link with invalid email (silent fail)
- [ ] Email arrives within 30 seconds
- [ ] Click link in email
- [ ] Token validates correctly
- [ ] Form prevents mismatched passwords
- [ ] Form prevents short passwords
- [ ] Password updates successfully
- [ ] Token expires after 1 hour
- [ ] Can't use token twice
- [ ] Mobile responsive

---

## Troubleshooting

**Email not sending?**
- Check Resend API key in .env
- Verify sender email is verified in Resend
- Check server logs for errors

**Token validation fails?**
- Ensure token matches exactly (case-sensitive)
- Check token expiration time
- Verify server is running

**Password not updating?**
- Check Supabase service key has permissions
- Verify user ID is correct
- Check Supabase logs

---

## Next Steps

1. Implement password strength meter
2. Add OAuth options (Google, GitHub)
3. Add session management after reset
4. Add two-factor authentication
5. Monitor password reset attempts for suspicious activity

