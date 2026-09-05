export function detectMessageAction(text = '') {
  const clean = text.trim()
  if (clean.length < 4) return null
  const lower = clean.toLowerCase()

  if (/\b(video\s*call|facetime|camera\s*call)\b/.test(lower)) {
    return { type: 'video-call', label: 'Start video call' }
  }

  if (/\b(call|ring|phone)\b/.test(lower)) {
    return { type: 'voice-call', label: 'Start voice call' }
  }

  if (clean.includes('?') && /\b(or|which|pick|vote|choose)\b/.test(lower)) {
    return { type: 'poll', label: 'Turn this into a poll' }
  }

  if (/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?\s?(am|pm))\b/.test(lower)) {
    return { type: 'plan', label: 'Turn this into a plan' }
  }

  return null
}
