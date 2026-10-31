// Drive upload recovery must never choose an arbitrary same-sized file.
// Even though Google filters on appProperties, verify ownership again before
// returning an ID that the upload finalisation endpoint will share.
function normaliseName(value) {
  return (String(value || 'attachment')
    .replace(/[\u0000-\u001f]/g, '')
    .normalize('NFC')
    .trim()
    .slice(0, 200) || 'attachment')
}

export function pickDriveUploadCandidate(files, { userId, fileName, size, cutoff }) {
  if (!userId || !Number.isSafeInteger(size) || size <= 0 || !Number.isFinite(cutoff)) {
    return { fileId: null, ambiguous: false }
  }

  const candidates = (Array.isArray(files) ? files : []).filter((file) => {
    if (!file || typeof file.id !== 'string' || !file.id) return false
    if (file.appProperties?.wavoUserId !== userId || file.appProperties?.wavoSource !== 'chat') return false
    if (Number(file.size) !== size) return false
    const created = new Date(file.createdTime || 0).getTime()
    return Number.isFinite(created) && created >= cutoff
  })

  const exact = candidates.filter((file) => normaliseName(file.name) === normaliseName(fileName))
  if (exact.length === 1) return { fileId: exact[0].id, ambiguous: false }
  if (exact.length > 1) return { fileId: null, ambiguous: true }

  // iOS sometimes changes a filename during upload. A size-only fallback is
  // safe only when exactly one recent, user-owned chat upload qualifies.
  if (candidates.length === 1) return { fileId: candidates[0].id, ambiguous: false }
  return { fileId: null, ambiguous: candidates.length > 1 }
}
