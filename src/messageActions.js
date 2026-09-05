function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function parsePollOptions(text) {
  const clean = cleanText(text).replace(/\?+$/, '')
  const orMatch = clean.match(/(?:^|\s)([^?]{1,48}?)\s+or\s+([^?]{1,48})(?:\?|$)/i)
  if (!orMatch) return []
  const left = orMatch[1].split(/[,;:]/).at(-1)?.trim()
  const right = orMatch[2].split(/[,;]/)[0]?.trim()
  return [left, right].filter(Boolean).map((value) => value.slice(0, 80))
}

function parseWhen(text) {
  const lower = text.toLowerCase()
  const now = new Date()
  const result = new Date(now)
  result.setSeconds(0, 0)

  if (lower.includes('tomorrow')) result.setDate(result.getDate() + 1)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (let index = 0; index < dayNames.length; index += 1) {
    if (!lower.includes(dayNames[index])) continue
    let delta = (index - result.getDay() + 7) % 7
    if (delta === 0) delta = 7
    result.setDate(result.getDate() + delta)
    break
  }

  const time = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (time) {
    let hour = Number(time[1])
    const minute = Number(time[2] || 0)
    if (time[3] === 'pm' && hour < 12) hour += 12
    if (time[3] === 'am' && hour === 12) hour = 0
    if (!time[3] && hour <= 7) hour += 12
    result.setHours(Math.min(hour, 23), Math.min(minute, 59), 0, 0)
  } else if (lower.includes('tonight')) {
    result.setHours(19, 0, 0, 0)
  } else if (lower.includes('tomorrow')) {
    result.setHours(16, 0, 0, 0)
  }

  return result
}

function planTitle(text) {
  return cleanText(text)
    .replace(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(at|around)\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/[?]+$/g, '')
    .replace(/\b(wanna|want to|do you want to|should we|are we)\b/gi, '')
    .trim()
    .slice(0, 80) || 'Hang out'
}

export function detectMessageAction(text = '') {
  const clean = cleanText(text)
  if (clean.length < 4) return null
  const lower = clean.toLowerCase()

  if (/\b(video\s*call|facetime|camera\s*call)\b/.test(lower)) {
    return { type: 'video-call', label: 'Start video call', draft: clean, confidence: 'high' }
  }

  if (/\b(call me|can (you|u) call|ring me|phone me|give me a call)\b/.test(lower)) {
    return { type: 'voice-call', label: 'Call them', draft: clean, confidence: 'high' }
  }

  const pollOptions = parsePollOptions(clean)
  if (clean.includes('?') && (pollOptions.length >= 2 || /\b(which|pick|vote|choose)\b/.test(lower))) {
    return {
      type: 'poll',
      label: 'Make a poll',
      question: clean,
      options: pollOptions,
      confidence: pollOptions.length >= 2 ? 'high' : 'medium',
    }
  }

  if (/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?\s?(am|pm))\b/.test(lower)) {
    return {
      type: 'plan',
      label: 'Make a Come?',
      title: planTitle(clean),
      startsAt: parseWhen(clean).toISOString(),
      confidence: 'high',
    }
  }

  if (/\b(free\?|you free|u free|around\?)\b/.test(lower)) {
    return { type: 'knock', label: 'Send a Knock', draft: clean, confidence: 'medium' }
  }

  return null
}
