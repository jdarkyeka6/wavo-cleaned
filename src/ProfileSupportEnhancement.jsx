import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, LifeBuoy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import './profile-support.css'

const HOST_ATTR = 'data-wavo-profile-support-host'

export default function ProfileSupportEnhancement() {
  const navigate = useNavigate()
  const [host, setHost] = useState(null)

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
        nextHost.className = 'wavo-profile-support-host'

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

  if (!host) return null

  return createPortal(
    <section className="wavo-profile-support-card" aria-label="Wavo Support">
      <div className="wavo-profile-support-copy">
        <span className="wavo-profile-support-icon"><LifeBuoy size={20} /></span>
        <div>
          <strong>Wavo Support</strong>
          <span>Questions, bugs, notifications, accounts, Premium and troubleshooting.</span>
        </div>
      </div>
      <button type="button" className="wavo-profile-support-button" onClick={() => navigate('/support')}>
        Open Support
        <ChevronRight size={18} />
      </button>
    </section>,
    host,
  )
}
