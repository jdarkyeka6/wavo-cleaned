import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import { supabase } from './supabaseClient'
import './admin-password-reset.css'

const HOST_ATTR = 'data-wavo-admin-password-reset-host'

async function invokeAdminReset(username, newPassword) {
  const { data, error } = await supabase.functions.invoke('admin-reset-password', {
    body: { username, newPassword },
  })
  if (!error) return data || {}

  let message = ''
  try {
    const response = error?.context
    if (response?.clone) {
      const body = await response.clone().json()
      message = body?.message || body?.error || ''
    }
  } catch {}
  throw new Error(message || error?.message || 'Wavo could not reset that password.')
}

function generatedPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
}

export default function AdminPasswordReset() {
  const [host, setHost] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const sync = () => {
      const search = document.querySelector('.admin-body .admin-search')
      const body = search?.parentElement
      if (!search || !body) {
        setHost((current) => current ? null : current)
        return
      }

      let next = body.querySelector(`[${HOST_ATTR}]`)
      if (!next) {
        next = document.createElement('div')
        next.setAttribute(HOST_ATTR, '')
        next.className = 'wavo-admin-password-reset-host'
        body.insertBefore(next, search)
      }
      setHost((current) => current === next ? current : next)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  function makePassword() {
    const next = generatedPassword()
    setPassword(next)
    setConfirm(next)
    setShowPassword(true)
    setError('')
    setSuccess('')
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const cleanUsername = username.trim()
    if (!cleanUsername) return setError('Enter a Wavo username.')
    if (password.length < 8 || password.length > 128) return setError('Use a password with 8 to 128 characters.')
    if (password !== confirm) return setError('The passwords do not match.')

    setBusy(true)
    try {
      const result = await invokeAdminReset(cleanUsername, password)
      setSuccess(`Password reset for @${result.username || cleanUsername}. The new password is active immediately.`)
      setUsername('')
      setPassword('')
      setConfirm('')
      setShowPassword(false)
    } catch (err) {
      setError(err?.message || 'Wavo could not reset that password.')
    } finally {
      setBusy(false)
    }
  }

  if (!host) return null

  return createPortal(
    <section className="admin-password-reset-card" aria-label="Admin password reset">
      <div className="admin-password-reset-head">
        <span className="admin-password-reset-icon"><KeyRound size={19}/></span>
        <div>
          <strong>Reset a user password</strong>
          <span>Type the Wavo username and set a temporary or replacement password.</span>
        </div>
      </div>

      <form className="admin-password-reset-form" onSubmit={submit}>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Wavo username"
            disabled={busy}
            required
          />
        </label>

        <div className="admin-password-reset-password-row">
          <label>
            New password
            <div className="admin-password-reset-password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                placeholder="At least 8 characters"
                disabled={busy}
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={busy}>
                {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>} 
              </button>
            </div>
          </label>

          <label>
            Confirm password
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              placeholder="Type it again"
              disabled={busy}
              required
            />
          </label>
        </div>

        <div className="admin-password-reset-actions">
          <button type="button" className="admin-password-generate" onClick={makePassword} disabled={busy}>
            <RefreshCw size={15}/> Generate password
          </button>
          <button type="submit" className="admin-password-submit" disabled={busy || !username.trim() || !password || !confirm}>
            <KeyRound size={15}/> {busy ? 'Resetting…' : 'Reset password'}
          </button>
        </div>

        {error && <div className="admin-password-reset-error">{error}</div>}
        {success && <div className="admin-password-reset-success"><CheckCircle2 size={16}/><span>{success}</span></div>}
      </form>

      <p className="admin-password-reset-note">This is an admin action and is recorded in the audit log. The password itself is never stored there.</p>
    </section>,
    host,
  )
}
