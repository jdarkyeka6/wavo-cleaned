import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

// Username surfaces that were added after the original cosmetics pass.
// Core chat/profile names are already handled by PremiumCosmeticsEnhancement.
const NAME_SELECTORS = [
  '.gmm-person-main strong',
  '.member-profile strong',
  '.pd-person-copy strong',
  '.next-now-person > strong',
]

function directText(node) {
  return [...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.nodeValue || '')
    .join('')
    .trim()
}

export default function ColourPolish() {
  const profileCache = useRef(new Map())
  const catalogueRef = useRef(new Map())
  const timer = useRef(null)

  useEffect(() => {
    let disposed = false

    const loadCatalogue = async () => {
      const { data, error } = await supabase
        .from('cosmetics')
        .select('id,name,kind,payload')
      if (error) {
        console.warn('[wavo] colour polish catalogue', error.message)
        return
      }
      catalogueRef.current = new Map((data || []).map((item) => [item.id, item]))
    }

    const decorate = async () => {
      if (disposed) return
      const targets = [...document.querySelectorAll(NAME_SELECTORS.join(','))]
      if (!targets.length) return

      const names = targets
        .map((node) => directText(node) || node.dataset.wavoColourRawName || '')
        .filter(Boolean)
      const unknown = [...new Set(names)].filter((name) => !profileCache.current.has(name))

      if (unknown.length) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,username,equipped_badge,equipped_name_style')
          .in('username', unknown.slice(0, 80))
        if (!error) {
          ;(data || []).forEach((profile) => profileCache.current.set(profile.username, profile))
        }
      }
      if (disposed) return

      targets.forEach((node) => {
        const raw = directText(node) || node.dataset.wavoColourRawName || ''
        if (!raw) return
        node.dataset.wavoColourRawName = raw

        const person = profileCache.current.get(raw)
        const signature = person
          ? `${raw}|${person.equipped_name_style || ''}|${person.equipped_badge || ''}`
          : `${raw}|none`
        if (node.dataset.wavoColourSignature === signature) return

        node.querySelector(':scope > .wavo-colour-badge')?.remove()
        node.classList.remove('user-label-name', 'is-gradient', 'is-animated')
        node.style.removeProperty('background-image')
        node.style.removeProperty('color')
        node.dataset.wavoColourSignature = signature
        if (!person) return

        const style = catalogueRef.current.get(person.equipped_name_style)
        const badge = catalogueRef.current.get(person.equipped_badge)

        if (style?.payload?.gradient) {
          node.classList.add('user-label-name', 'is-gradient')
          if (style.payload.animated) node.classList.add('is-animated')
          node.style.backgroundImage = style.payload.gradient
        } else if (style?.payload?.color) {
          node.classList.add('user-label-name')
          node.style.color = style.payload.color
        }

        if (badge?.payload?.emoji) {
          const chip = document.createElement('span')
          chip.className = 'wavo-inline-badge wavo-colour-badge'
          chip.textContent = badge.payload.emoji
          chip.title = badge.name || 'Wavo badge'
          if (badge.payload.color) chip.style.color = badge.payload.color
          node.appendChild(chip)
        }
      })
    }

    const schedule = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(decorate, 90)
    }

    loadCatalogue().then(schedule)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      clearTimeout(timer.current)
      observer.disconnect()
    }
  }, [])

  return null
}
