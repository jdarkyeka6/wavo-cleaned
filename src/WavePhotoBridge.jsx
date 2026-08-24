import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { getFriends, getPosts } from './wavoData'
import './wave-photo-bridge.css'

const SIGNED_URL_SECONDS = 15 * 60
const REFRESH_SIGNED_URLS_MS = 10 * 60 * 1000

function normalise(value) {
  return String(value || '').trim()
}

function relativeTime(value) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function postKey(author, body, relative = '') {
  return `${normalise(author).toLowerCase()}\u0000${normalise(body)}\u0000${normalise(relative)}`
}

async function getSignedMedia(post) {
  if (!post?.media_path) return null
  const { data, error } = await supabase.storage
    .from('wave-media')
    .createSignedUrl(post.media_path, SIGNED_URL_SECONDS)
  if (error || !data?.signedUrl) return null
  return { ...post, signedUrl: data.signedUrl }
}

function isPrimaryWaveCreateButton(button) {
  if (!(button instanceof HTMLButtonElement)) return false
  if (button.dataset.oldWaveHidden === '1' || button.style.display === 'none') return false

  const title = normalise(button.querySelector('strong')?.textContent)
  const hint = normalise(button.querySelector('span')?.textContent).toLowerCase()

  // Before UiEnhancements runs this is "Post". After it runs it is the
  // friend-only "Wave" button. The legacy expiring Wave is deliberately not
  // redirected here.
  return title === 'Post' || (title === 'Wave' && hint.includes('friends'))
}

function isNewWaveAction(button) {
  if (!(button instanceof HTMLButtonElement)) return false
  const text = normalise(button.textContent).toLowerCase()
  return text === 'new post' || text === 'new wave'
}

function installCreateEntryPoints(navigate) {
  const createButtons = [...document.querySelectorAll('.create-grid > button')]
  for (const button of createButtons) {
    if (!isPrimaryWaveCreateButton(button) || button.dataset.wavoPhotoRoute === '1') continue
    button.dataset.wavoPhotoRoute = '1'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      navigate('/waves?compose=1')
    }, true)
  }

  const actionButtons = [...document.querySelectorAll('.section-heading > button')]
  for (const button of actionButtons) {
    if (!isNewWaveAction(button) || button.dataset.wavoPhotoRoute === '1') continue
    button.dataset.wavoPhotoRoute = '1'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      navigate('/waves?compose=1')
    }, true)
  }
}

function maybeAutoOpenComposer(navigate) {
  if (window.location.pathname !== '/waves') return false
  const params = new URLSearchParams(window.location.search)
  if (params.get('compose') !== '1') return false
  if (document.querySelector('.waves-composer')) return true

  const button = [...document.querySelectorAll('.waves-topbar > button, .waves-intro > button, .waves-empty > button')]
    .find((node) => /new wave|share|create the first wave/i.test(normalise(node.textContent)))

  if (!button) return false
  button.click()
  navigate('/waves', { replace: true })
  return true
}

function injectMediaIntoCards(mediaRows) {
  if (!mediaRows.length) return

  const byKey = new Map()
  for (const row of mediaRows) {
    const key = postKey(row.author?.username, row.body, relativeTime(row.created_at))
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }

  const occurrence = new Map()
  const cards = [...document.querySelectorAll('.post-card')]

  for (const card of cards) {
    const author = card.querySelector('.wave-head strong')?.textContent
    const body = card.querySelector(':scope > p')?.textContent || ''
    const relative = card.querySelector('.wave-head > div span')?.textContent || ''
    const key = postKey(author, body, relative)
    const rows = byKey.get(key)
    if (!rows?.length) continue

    const used = occurrence.get(key) || 0
    const row = rows[Math.min(used, rows.length - 1)]
    occurrence.set(key, used + 1)
    if (!row?.signedUrl) continue

    let host = card.querySelector(':scope > .wavo-post-media')
    if (!host) {
      host = document.createElement('div')
      host.className = 'wavo-post-media'
      const head = card.querySelector(':scope > .wave-head')
      if (head) head.insertAdjacentElement('afterend', host)
      else card.prepend(host)
    }

    if (host.dataset.postId === row.id && host.dataset.mediaUrl === row.signedUrl) continue
    host.replaceChildren()
    host.dataset.postId = row.id
    host.dataset.mediaUrl = row.signedUrl

    if (row.media_type === 'video') {
      const video = document.createElement('video')
      video.src = row.signedUrl
      video.controls = true
      video.preload = 'metadata'
      video.playsInline = true
      host.appendChild(video)
    } else {
      const image = document.createElement('img')
      image.src = row.signedUrl
      image.alt = 'Shared Wave photo'
      image.loading = 'lazy'
      host.appendChild(image)
    }
  }
}

export default function WavePhotoBridge() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState(null)
  const [mediaRows, setMediaRows] = useState([])

  useEffect(() => {
    let live = true
    supabase.auth.getUser().then(({ data }) => {
      if (live) setUserId(data.user?.id || null)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null)
    })
    return () => {
      live = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId || window.location.pathname === '/waves') {
      setMediaRows([])
      return
    }

    let cancelled = false

    async function load() {
      try {
        const friends = await getFriends(userId)
        const posts = await getPosts(userId, friends)
        const signed = await Promise.all(posts.filter((post) => post.media_path).map(getSignedMedia))
        if (!cancelled) setMediaRows(signed.filter(Boolean))
      } catch (error) {
        console.error('[wavo] hydrate Wave media', error)
      }
    }

    load()
    const timer = window.setInterval(load, REFRESH_SIGNED_URLS_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [userId])

  useEffect(() => {
    let raf = 0
    function scan() {
      window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(() => {
        installCreateEntryPoints(navigate)
        maybeAutoOpenComposer(navigate)
        injectMediaIntoCards(mediaRows)
      })
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      window.cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [mediaRows, navigate])

  return null
}
