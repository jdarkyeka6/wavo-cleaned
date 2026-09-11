import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { clearUserOfflineData } from './offline'
import './account-deletion.css'

const HOST_ATTR = 'data-wavo-account-deletion-host'

export default function AccountDeletion() {
  const [host, setHost] = useState(null)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user?.id || null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUserId(session?.user?.id || null)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const syncHost = () => {
      const profileHero = document.querySelector('.profile-hero')
      const profileScreen = profileHero?.closest('.screen')
      if (!profileScreen) {
        setHost((current) => (current ? null : current))
        return
      }

      let nextHost = profileScreen.querySelector(`[${HOST_ATTR}]`)
      if (!nextHost) {
        nextHost = document.createElement('div')
        nextHost.setAttribute(HOST_ATTR, '')
        nextHost.className = 'wavo-account-deletion-host'
        const logoutButton = profileScreen.querySelector('.logout-button')
        if (logoutButton) profileScreen.insertBefore(nextHost, logoutButton)
        else profileScreen.appendChild(nextHost)
      }
      setHost((current) => (current === nextHost ? current : nextHost))
    }

    syncHost()
    const observer = new MutationObserver(syncHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy])

  function close() {
    if (busy) return
    setOpen(false)
    setConfirmation('')
    setError('')
  }

  async function deleteAccount() {
    if (confirmation !== 'DELETE' || busy) return
    setBusy(true)
    setError('')

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('delete-account', {
        body: { confirmation: 'DELETE' },
      })
      if (invokeError || data?.deleted !== true) throw invokeError || new Error('Deletion was not confirmed')

      if (userId) clearUserOfflineData(userId)
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
        // The server has already deleted the account. Reloading below clears the UI.
      }
      window.location.replace('/')
    } catch (err) {
      console.error('[wavo] account deletion failed', err)
      setError("We couldn't delete your account. Nothing else was changed. Please try again.")
      setBusy(false)
    }
  }

  if (!host) return null

  return createPortal(
    <>
      <section className="wavo-account-card" aria-label="Account settings">
        <div className="wavo-account-copy">
          <span className="wavo-account-icon"><Trash2 size={20} /></span>
          <div>
            <strong>Account</strong>
            <span>Manage or permanently delete your Wavo account.</span>
          </div>
        </div>
        <button type="button" className="wavo-delete-account-button" onClick={() => setOpen(true)}>
          Delete account
        </button>
      </section>

      {open && createPortal(
        <div className="wavo-delete-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="wavo-delete-modal" role="dialog" aria-modal="true" aria-labelledby="wavo-delete-title">
            <div className="wavo-delete-header">
              <span className="wavo-delete-warning"><AlertTriangle size={22} /></span>
              <div>
                <span className="wavo-delete-eyebrow">PERMANENT ACCOUNT DELETION</span>
                <h2 id="wavo-delete-title">Delete your Wavo account?</h2>
              </div>
              <button type="button" className="wavo-delete-close" onClick={close} disabled={busy} aria-label="Close"><X size={20} /></button>
            </div>

            <p className="wavo-delete-lead">This cannot be undone. Your Wavo account and associated user data will be permanently deleted.</p>
            <ul className="wavo-delete-list">
              <li>Your profile and account will be removed.</li>
              <li>Your Wavo messages, posts, Waves, friendships and account-linked activity will be removed.</li>
              <li>Files you uploaded to Wavo under this account will be removed.</li>
              <li>You will be signed out when deletion finishes.</li>
            </ul>

            <label className="wavo-delete-confirm-label" htmlFor="wavo-delete-confirm">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              id="wavo-delete-confirm"
              className="wavo-delete-confirm-input"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              disabled={busy}
              placeholder="DELETE"
            />

            {error && <div className="wavo-delete-error" role="alert">{error}</div>}

            <div className="wavo-delete-actions">
              <button type="button" className="wavo-delete-cancel" onClick={close} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="wavo-delete-confirm-button"
                onClick={deleteAccount}
                disabled={confirmation !== 'DELETE' || busy}
              >
                {busy ? 'Deleting account…' : 'Permanently delete account'}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>,
    host,
  )
}
