import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronRight, KeyRound, Mail, ShieldCheck, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import './account-recovery.css'

const AUTH_HOST = 'data-wavo-account-recovery-auth-host'
const PROFILE_HOST = 'data-wavo-account-recovery-profile-host'

async function invokeRecovery(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('account-recovery', {
    body: { action, ...payload },
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
  throw new Error(message || error?.message || 'Wavo could not complete that request.')
}

function cleanRecoveryParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('reset_token')
  url.searchParams.delete('verify_recovery_token')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function Modal({ children, onClose, locked = false }) {
  return createPortal(
    <div className="wavo-recovery-overlay" onMouseDown={(event) => !locked && event.target === event.currentTarget && onClose?.()}>
      <section className="wavo-recovery-sheet" role="dialog" aria-modal="true">
        <div className="wavo-recovery-grabber" />
        {!locked && <button className="wavo-recovery-close" type="button" onClick={onClose} aria-label="Close"><X size={18}/></button>}
        {children}
      </section>
    </div>,
    document.body,
  )
}

function SheetHead({ icon: Icon, title, copy }) {
  return <div className="wavo-recovery-head">
    <span><Icon size={21}/></span>
    <div><h2>{title}</h2><p>{copy}</p></div>
  </div>
}

export default function AccountRecoveryEnhancement() {
  const [authHost, setAuthHost] = useState(null)
  const [profileHost, setProfileHost] = useState(null)
  const [session, setSession] = useState(null)
  const [loginMode, setLoginMode] = useState(false)
  const [mode, setMode] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verifyState, setVerifyState] = useState('')

  const refreshStatus = useCallback(async () => {
    if (!session?.user?.id) { setStatus(null); return }
    try { setStatus(await invokeRecovery('status')) }
    catch { setStatus(null) }
  }, [session?.user?.id])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (active) setSession(next || null) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get('reset_token')
    const verifyToken = new URLSearchParams(window.location.search).get('verify_recovery_token')
    if (resetToken) setMode('reset-link')
    else if (verifyToken) setMode('verify-email')
  }, [])

  useEffect(() => {
    const sync = () => {
      const authCard = document.querySelector('.auth-card')
      if (authCard) {
        let next = authCard.querySelector(`[${AUTH_HOST}]`)
        if (!next) {
          next = document.createElement('div')
          next.setAttribute(AUTH_HOST, '')
          next.className = 'wavo-account-recovery-auth-host'
          const form = authCard.querySelector('form')
          if (form?.nextSibling) authCard.insertBefore(next, form.nextSibling)
          else authCard.appendChild(next)
        }
        setAuthHost((old) => old === next ? old : next)
        const toggle = [...authCard.querySelectorAll('button')].find((button) => button.textContent?.includes('Create an account') || button.textContent?.includes('Log in'))
        setLoginMode(Boolean(toggle?.textContent?.includes('Create an account')))
      } else setAuthHost((old) => old ? null : old)

      const profileScreen = document.querySelector('.profile-hero')?.closest('.screen')
      if (profileScreen) {
        let next = profileScreen.querySelector(`[${PROFILE_HOST}]`)
        if (!next) {
          next = document.createElement('div')
          next.setAttribute(PROFILE_HOST, '')
          next.className = 'wavo-account-recovery-profile-host'
          const support = profileScreen.querySelector('[data-wavo-profile-support-host]')
          const logout = profileScreen.querySelector('.logout-button')
          if (support) profileScreen.insertBefore(next, support)
          else if (logout) profileScreen.insertBefore(next, logout)
          else profileScreen.appendChild(next)
        }
        setProfileHost((old) => old === next ? old : next)
      } else setProfileHost((old) => old ? null : old)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (mode !== 'verify-email' || verifyState) return
    const token = new URLSearchParams(window.location.search).get('verify_recovery_token')
    if (!token) { setVerifyState('error'); setError('That verification link is missing.'); return }
    setVerifyState('working')
    setError('')
    invokeRecovery('verify-recovery-email', { token })
      .then(() => { setVerifyState('done'); cleanRecoveryParams(); refreshStatus() })
      .catch((err) => { setVerifyState('error'); setError(err.message) })
  }, [mode, verifyState, refreshStatus])

  function resetFields() {
    setError(''); setNotice(''); setEmail(''); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
  }

  function close() {
    resetFields(); setMode(null); setVerifyState('')
  }

  async function requestReset(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const health = await invokeRecovery('health')
      if (!health?.email_delivery_configured) throw new Error('Password reset email is temporarily unavailable. Try again later.')
      await invokeRecovery('request-reset', { username: username.trim() })
      setNotice('If that account has a verified recovery email, a reset link has been sent. The link expires in 1 hour.')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function resetFromLink(event) {
    event.preventDefault(); setError('')
    if (newPassword !== confirmPassword) return setError('The new passwords do not match.')
    if (newPassword.length < 8) return setError('Use at least 8 characters.')
    const token = new URLSearchParams(window.location.search).get('reset_token')
    if (!token) return setError('That reset link is missing.')
    setBusy(true)
    try {
      await invokeRecovery('reset-password', { token, newPassword })
      cleanRecoveryParams(); setNotice('Password updated. You can now log in with the new password.')
      setNewPassword(''); setConfirmPassword('')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function saveRecoveryEmail(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const health = await invokeRecovery('health')
      if (!health?.email_delivery_configured) throw new Error('Recovery email verification is temporarily unavailable.')
      const result = await invokeRecovery('begin-email-verification', { email, currentPassword })
      setNotice(`Verification sent to ${result?.masked_email || 'that email'}. Open the link within 1 hour.`)
      setEmail(''); setCurrentPassword(''); await refreshStatus()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function changePassword(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (newPassword !== confirmPassword) return setError('The new passwords do not match.')
    if (newPassword.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    try {
      await invokeRecovery('change-password', { currentPassword, newPassword })
      setNotice('Password changed.')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  return <>
    {authHost && loginMode && createPortal(
      <button type="button" className="wavo-forgot-password" onClick={() => { resetFields(); setMode('forgot') }}>
        <KeyRound size={15}/> Forgot password?
      </button>,
      authHost,
    )}

    {profileHost && session && createPortal(
      <section className="wavo-recovery-card" aria-label="Account security">
        <div className="wavo-recovery-card-copy">
          <span className="wavo-recovery-card-icon"><ShieldCheck size={20}/></span>
          <div>
            <strong>Account security</strong>
            <span>{status?.verified ? `Recovery email · ${status.recovery_email_masked}` : status?.pending_recovery_email ? `Waiting for verification · ${status.pending_recovery_email_masked}` : 'Add a recovery email so you can reset a forgotten password.'}</span>
          </div>
        </div>
        <div className="wavo-recovery-card-actions">
          <button type="button" onClick={() => { resetFields(); setEmail(status?.recovery_email || ''); setMode('recovery-email') }}>
            {status?.verified ? 'Change recovery email' : 'Add recovery email'} <ChevronRight size={16}/>
          </button>
          <button type="button" onClick={() => { resetFields(); setMode('change-password') }}>
            Change password <ChevronRight size={16}/>
          </button>
        </div>
      </section>,
      profileHost,
    )}

    {mode === 'forgot' && <Modal onClose={close}>
      <SheetHead icon={KeyRound} title="Reset your password" copy="Enter your Wavo username. If a verified recovery email is attached, Wavo will send a secure reset link."/>
      {!notice ? <form className="wavo-recovery-form" onSubmit={requestReset}>
        <label>Username<input autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your Wavo username" required disabled={busy}/></label>
        {error && <div className="wavo-recovery-error">{error}</div>}
        <button className="wavo-recovery-primary" disabled={busy || !username.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form> : <div className="wavo-recovery-success"><Mail size={22}/><strong>Check your email</strong><p>{notice}</p></div>}
    </Modal>}

    {mode === 'reset-link' && <Modal onClose={() => { cleanRecoveryParams(); close() }} locked={!notice}>
      <SheetHead icon={KeyRound} title={notice ? 'Password updated' : 'Create a new password'} copy={notice || 'Choose a new password for your Wavo account.'}/>
      {!notice && <form className="wavo-recovery-form" onSubmit={resetFromLink}>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required disabled={busy} placeholder="At least 8 characters"/></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required disabled={busy} placeholder="Type it again"/></label>
        {error && <div className="wavo-recovery-error">{error}</div>}
        <button className="wavo-recovery-primary" disabled={busy || !newPassword || !confirmPassword}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>}
      {notice && <button type="button" className="wavo-recovery-primary" onClick={() => { cleanRecoveryParams(); window.location.assign('/') }}>Back to Wavo</button>}
    </Modal>}

    {mode === 'verify-email' && <Modal onClose={close} locked={verifyState === 'working'}>
      <SheetHead icon={Mail} title="Verify recovery email" copy={verifyState === 'working' ? 'Checking your secure verification link…' : verifyState === 'done' ? 'Your recovery email is verified.' : 'Wavo could not verify this link.'}/>
      {verifyState === 'working' && <div className="wavo-recovery-loading">Verifying…</div>}
      {verifyState === 'done' && <div className="wavo-recovery-success"><CheckCircle2 size={24}/><strong>Recovery is ready</strong><p>You can now use this email to reset a forgotten password.</p><button className="wavo-recovery-primary" onClick={() => window.location.assign('/')}>Open Wavo</button></div>}
      {verifyState === 'error' && <div className="wavo-recovery-error">{error}</div>}
    </Modal>}

    {mode === 'recovery-email' && <Modal onClose={close}>
      <SheetHead icon={Mail} title="Recovery email" copy="Wavo will verify this address before it can be used for password resets. Your current password is required to change it."/>
      <form className="wavo-recovery-form" onSubmit={saveRecoveryEmail}>
        <label>Recovery email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required disabled={busy}/></label>
        <label>Current Wavo password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required disabled={busy}/></label>
        {error && <div className="wavo-recovery-error">{error}</div>}
        {notice && <div className="wavo-recovery-notice">{notice}</div>}
        <button className="wavo-recovery-primary" disabled={busy || !email.trim() || !currentPassword}>{busy ? 'Sending…' : 'Verify recovery email'}</button>
      </form>
    </Modal>}

    {mode === 'change-password' && <Modal onClose={close}>
      <SheetHead icon={KeyRound} title="Change password" copy="Confirm your current password, then choose a new one."/>
      <form className="wavo-recovery-form" onSubmit={changePassword}>
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required disabled={busy}/></label>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required disabled={busy} placeholder="At least 8 characters"/></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required disabled={busy}/></label>
        {error && <div className="wavo-recovery-error">{error}</div>}
        {notice && <div className="wavo-recovery-notice">{notice}</div>}
        <button className="wavo-recovery-primary" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? 'Changing…' : 'Change password'}</button>
      </form>
    </Modal>}
  </>
}
