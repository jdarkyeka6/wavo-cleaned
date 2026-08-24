import { useEffect, useState } from 'react'
import { getUiMode } from './layout'

export function useUiMode() {
  const [mode, setMode] = useState(() => getUiMode())

  useEffect(() => {
    const update = (event) => setMode(event?.detail?.mode || getUiMode())
    window.addEventListener('wavo:ui-mode', update)
    update()
    return () => window.removeEventListener('wavo:ui-mode', update)
  }, [])

  return mode
}

export function useIsMobileUi() {
  return useUiMode() !== 'desktop-web'
}
