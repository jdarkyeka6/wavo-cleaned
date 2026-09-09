const INSTALL_KEY = '__WAVO_PLACE_MARKERS_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true

  const LAST_CHAT_KEY = 'wavo:last-chat'
  const LAST_SPACE_KEY = 'wavo:last-space'
  const RESTORE_TIMEOUT = 15000
  let restoreIntent = null
  let restoreStartedAt = 0
  let frame = 0

  const clean = (value) => String(value || '').trim()
  const lower = (value) => clean(value).toLowerCase()
  const decode = (value) => {
    try { return decodeURIComponent(value || '') } catch { return value || '' }
  }
  const encode = (value) => encodeURIComponent(clean(value))

  function readSession(key) {
    try { return sessionStorage.getItem(key) || '' } catch { return '' }
  }

  function writeSession(key, value) {
    try { if (value) sessionStorage.setItem(key, value) } catch {}
  }

  function parseIntent(pathname = window.location.pathname) {
    const parts = pathname.split('/').filter(Boolean).map(decode)
    const head = lower(parts[0])

    if (!parts.length || head === 'home') return { kind: 'home' }
    if (head === 'inbox' || head === 'messages') return { kind: 'inbox' }
    if (head === 'chat') return { kind: 'chat', value: clean(parts.slice(1).join('/')) || readSession(LAST_CHAT_KEY) }
    if (head === 'spaces' || head === 'groups') return { kind: 'spaces' }
    if (head === 'space') return { kind: 'space', value: clean(parts.slice(1).join('/')) || readSession(LAST_SPACE_KEY) }
    if (head === 'profile' || head === 'you' || head === 'settings') return { kind: 'profile' }
    if (head === 'subscriptions' || head === 'plans' || head === 'pricing') return { kind: 'subscriptions' }
    return null
  }

  function currentPath() {
    return window.location.pathname.replace(/\/+$/, '') || '/'
  }

  function setPath(path, { replace = false } = {}) {
    const next = path.replace(/\/+$/, '') || '/'
    if (currentPath() === next) return
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({ ...(window.history.state || {}), wavoPlaceMarker: true }, '', next)
  }

  function navButton(label) {
    return [...document.querySelectorAll('.bottom-nav button')].find((button) =>
      lower(button.querySelector('span')?.textContent) === lower(label),
    ) || null
  }

  function clickNav(label) {
    const button = navButton(label)
    if (!button) return false
    button.click()
    return true
  }

  function screenTitle() {
    return clean(document.querySelector('.screen-title h1')?.textContent)
  }

  function chatUsername() {
    const topbar = document.querySelector('.chat-screen .chat-topbar')
    if (!topbar) return ''
    const handle = [...topbar.querySelectorAll('span')]
      .map((node) => clean(node.textContent))
      .find((value) => value.startsWith('@'))
    if (handle) return handle.slice(1)
    return clean(topbar.querySelector('strong')?.textContent).replace(/^@/, '')
  }

  function spaceName() {
    return clean(document.querySelector('.space-hero h1')?.textContent)
  }

  function inboxReady() {
    return !document.querySelector('.chat-screen') && lower(screenTitle()) === 'inbox'
  }

  function spacesReady() {
    return !document.querySelector('.space-hero') && lower(screenTitle()) === 'spaces'
  }

  function profileReady() {
    return Boolean(document.querySelector('.profile-hero'))
  }

  function homeReady() {
    return Boolean(document.querySelector('.home-screen'))
  }

  function friendButton(username) {
    const wanted = lower(username).replace(/^@/, '')
    if (!wanted) return null
    return [...document.querySelectorAll('.friend-list .friend-button')].find((button) =>
      lower(button.querySelector('strong')?.textContent).replace(/^@/, '') === wanted,
    ) || null
  }

  function spaceButton(name) {
    const wanted = lower(name)
    if (!wanted) return null
    return [...document.querySelectorAll('.space-grid .space-card')].find((button) =>
      lower(button.querySelector('strong')?.textContent) === wanted,
    ) || null
  }

  function fulfil(intent) {
    if (!intent) return true

    if (intent.kind === 'home') {
      if (homeReady()) return true
      clickNav('Home')
      return false
    }

    if (intent.kind === 'inbox') {
      if (inboxReady()) return true
      clickNav('Inbox')
      return false
    }

    if (intent.kind === 'chat') {
      const wanted = clean(intent.value).replace(/^@/, '')
      const open = chatUsername()
      if (open && (!wanted || lower(open) === lower(wanted))) {
        writeSession(LAST_CHAT_KEY, open)
        return true
      }
      if (!wanted) {
        if (inboxReady()) return true
        clickNav('Inbox')
        return false
      }
      if (!inboxReady()) {
        clickNav('Inbox')
        return false
      }
      const button = friendButton(wanted)
      if (button) button.click()
      return false
    }

    if (intent.kind === 'spaces') {
      if (spacesReady()) return true
      clickNav('Spaces')
      return false
    }

    if (intent.kind === 'space') {
      const wanted = clean(intent.value)
      const open = spaceName()
      if (open && (!wanted || lower(open) === lower(wanted))) {
        writeSession(LAST_SPACE_KEY, open)
        return true
      }
      if (!wanted) {
        if (spacesReady()) return true
        clickNav('Spaces')
        return false
      }
      if (!spacesReady()) {
        clickNav('Spaces')
        return false
      }
      const button = spaceButton(wanted)
      if (button) button.click()
      return false
    }

    if (intent.kind === 'profile') {
      if (profileReady() && !document.querySelector('.wpc-modal')) return true
      clickNav('You')
      return false
    }

    if (intent.kind === 'subscriptions') {
      if (document.querySelector('.wpc-modal')) return true
      if (!profileReady()) {
        clickNav('You')
        return false
      }
      const trigger = document.querySelector('.wpc-trigger')
      if (trigger) trigger.click()
      return false
    }

    return true
  }

  function syncFromDom({ replace = false } = {}) {
    if (restoreIntent) return

    if (document.querySelector('.wpc-modal')) {
      setPath('/subscriptions', { replace })
      return
    }

    const chat = chatUsername()
    if (chat) {
      writeSession(LAST_CHAT_KEY, chat)
      setPath(`/chat/${encode(chat)}`, { replace })
      return
    }

    const space = spaceName()
    if (space) {
      writeSession(LAST_SPACE_KEY, space)
      setPath(`/space/${encode(space)}`, { replace })
      return
    }

    if (inboxReady()) {
      setPath('/inbox', { replace })
      return
    }
    if (spacesReady()) {
      setPath('/spaces', { replace })
      return
    }
    if (profileReady()) {
      setPath('/profile', { replace })
      return
    }
    if (homeReady()) setPath('/home', { replace })
  }

  function run() {
    frame = 0
    if (restoreIntent) {
      const done = fulfil(restoreIntent)
      if (done || Date.now() - restoreStartedAt > RESTORE_TIMEOUT) {
        restoreIntent = null
        syncFromDom({ replace: true })
      }
      return
    }
    syncFromDom()
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(run)
  }

  function restoreFromLocation() {
    const intent = parseIntent()
    if (!intent) {
      restoreIntent = null
      return
    }
    restoreIntent = intent
    restoreStartedAt = Date.now()
    schedule()
  }

  const observer = new MutationObserver(schedule)
  const start = () => {
    restoreFromLocation()
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('popstate', restoreFromLocation)
    window.addEventListener('wavo:navigate-place', restoreFromLocation)
    schedule()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
