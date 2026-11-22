export function sortInboxFriends(friends, activity) {
  return [...friends].sort((a, b) => {
    const aa = activity[a.id] || {}, bb = activity[b.id] || {}
    return Number(Boolean(bb.unread)) - Number(Boolean(aa.unread))
      || (Date.parse(bb.latestAt || '') || 0) - (Date.parse(aa.latestAt || '') || 0)
      || String(a.username || '').localeCompare(String(b.username || ''))
  })
}
