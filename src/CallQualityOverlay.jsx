import { useEffect, useState } from 'react'
import { AudioLines, Signal, SignalLow, VideoOff } from 'lucide-react'
import { turnConfigured } from './call-resilience'
import './call-quality.css'

function qualityLabel(quality, state) {
  if (state === 'disconnected' || state === 'failed') return 'Reconnecting'
  if (quality === 'poor') return 'Poor connection'
  if (quality === 'fair') return 'Fair connection'
  if (quality === 'good') return 'Good connection'
  return 'Connecting'
}

export default function CallQualityOverlay() {
  const [detail, setDetail] = useState(null)
  const [audioOnly, setAudioOnly] = useState(false)

  useEffect(() => {
    function onQuality(event) {
      const next = event.detail || null
      setDetail(next?.active ? next : null)
      if (!next?.active) setAudioOnly(false)
    }
    window.addEventListener('wavo:call-quality', onQuality)
    return () => window.removeEventListener('wavo:call-quality', onQuality)
  }, [])

  if (!detail) return null
  const poor = detail.quality === 'poor' || ['failed', 'disconnected'].includes(detail.state)
  const Icon = poor ? SignalLow : Signal

  function switchToAudio() {
    const button = document.querySelector('.wavo-call-controls button[aria-label="Turn camera off"]')
    if (button) {
      button.click()
      setAudioOnly(true)
    }
  }

  return (
    <aside className={`wavo-quality ${poor ? 'poor' : detail.quality === 'fair' ? 'fair' : ''}`} aria-live="polite">
      <Icon size={15} />
      <div>
        <strong>{qualityLabel(detail.quality, detail.state)}</strong>
        <small>
          {Number.isFinite(detail.rtt) && detail.rtt > 0 ? `${Math.round(detail.rtt * 1000)}ms` : ''}
          {Number.isFinite(detail.loss) && detail.loss > 0 ? `${detail.rtt ? ' · ' : ''}${Math.round(detail.loss * 100)}% loss` : ''}
          {!detail.rtt && !detail.loss ? (turnConfigured ? 'TURN fallback ready' : 'Direct connection') : ''}
        </small>
      </div>
      {detail.suggestAudio && !audioOnly && (
        <button onClick={switchToAudio}><VideoOff size={14} />Audio only</button>
      )}
      {audioOnly && <span className="wavo-quality-audio"><AudioLines size={13} />audio</span>}
    </aside>
  )
}
