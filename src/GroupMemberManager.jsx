import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import './group-member-manager.css'

function initial(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase()
}

function MemberAvatar({ profile }) {
  return (
    <div className="gmm-avatar">
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initial(profile?.username)}
    </div>
  )
}

function RoleBadge({ role }) {
  if (role === 'owner') return <span className="gmm-role owner"><Crown size={12} /> Owner</span>
  if (role === 'admin') return <span className="gmm-role admin"><ShieldCheck size={12} /> Admin</span>
  return <span className="gmm-role">Member</span>
}

export default function GroupMemberManager() {
  const [hero, setHero] = useState(null)
  const [spaceName, setSpaceName] = useState('')
  const [group, setGroup] = useState(null)
  const [myRole, setMyRole] = useState(null)
  const [members, setMembers] = useState([])
  const [candidates, setCandidates] = useState([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let raf = 0
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const nextHero = document.querySelector('.space-hero')
        const nextName = nextHero?.querySelector('h1')?.textContent?.trim() || ''
        setHero((prev) => (prev === nextHero ? prev : nextHero))
        setSpaceName((prev) => (prev === nextName ? prev : nextName))
        if (!nextHero) setOpen(false)
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  const loadRoster = useCallback(async (targetGroup, userId) => {
    if (!targetGroup?.id || !userId) return

    const [{ data: memberRows, error: memberError }, { data: friendRows, error: friendError }] = await Promise.all([
      supabase.from('group_members').select('user_id,role,joined_at').eq('group_id', targetGroup.id),
      supabase
        .from('friend_requests')
        .select('sender_id,receiver_id,status')
        .eq('status', 'accepted')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
    ])

    if (memberError) throw memberError
    if (friendError) throw friendError

    const memberIds = [...new Set((memberRows || []).map((row) => row.user_id).filter(Boolean))]
    const friendIds = [...new Set((friendRows || []).map((row) => row.sender_id === userId ? row.receiver_id : row.sender_id).filter(Boolean))]
    const profileIds = [...new Set([...memberIds, ...friendIds])]

    let profiles = []
    if (profileIds.length) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,avatar_url,status')
        .in('id', profileIds)
      if (error) throw error
      profiles = data || []
    }

    const profileMap = Object.fromEntries(profiles.map((profile) => [profile.id, profile]))
    const memberSet = new Set(memberIds)

    setMembers((memberRows || [])
      .map((row) => ({ ...row, profile: profileMap[row.user_id] || { id: row.user_id, username: 'Wavo user' } }))
      .sort((a, b) => {
        const weight = { owner: 0, admin: 1, member: 2 }
        return (weight[a.role] ?? 3) - (weight[b.role] ?? 3) || String(a.profile.username).localeCompare(String(b.profile.username))
      }))

    setCandidates(friendIds
      .filter((id) => !memberSet.has(id))
      .map((id) => profileMap[id])
      .filter(Boolean)
      .sort((a, b) => String(a.username).localeCompare(String(b.username))))
  }, [])

  useEffect(() => {
    let alive = true

    async function loadSpace() {
      if (!spaceName) {
        setGroup(null)
        setMyRole(null)
        setMembers([])
        setCandidates([])
        return
      }

      setLoading(true)
      setNotice('')
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const userId = sessionData.session?.user?.id
        if (!userId) return

        const { data: memberships, error: membershipError } = await supabase
          .from('group_members')
          .select('group_id,role')
          .eq('user_id', userId)
        if (membershipError) throw membershipError

        const groupIds = [...new Set((memberships || []).map((row) => row.group_id).filter(Boolean))]
        if (!groupIds.length) throw new Error('Space membership was not found.')

        const { data: groups, error: groupError } = await supabase
          .from('groups')
          .select('id,name,emoji,description,created_by')
          .in('id', groupIds)
          .eq('name', spaceName)
        if (groupError) throw groupError

        const selected = (groups || [])[0]
        if (!selected) throw new Error('This Space could not be matched to your membership.')
        const role = (memberships || []).find((row) => String(row.group_id) === String(selected.id))?.role || 'member'

        if (!alive) return
        setGroup(selected)
        setMyRole(role)
        await loadRoster(selected, userId)
      } catch (error) {
        console.error('[wavo] group member manager', error)
        if (alive) setNotice(error.message || 'Could not load members.')
      } finally {
        if (alive) setLoading(false)
      }
    }

    loadSpace()
    return () => { alive = false }
  }, [spaceName, loadRoster])

  const canManage = myRole === 'owner' || myRole === 'admin'
  const filteredCandidates = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return candidates
    return candidates.filter((profile) => String(profile.username || '').toLowerCase().includes(term))
  }, [candidates, query])

  async function addMember(profile) {
    if (!group?.id || !profile?.id || !canManage || addingId) return
    setAddingId(profile.id)
    setNotice('')
    try {
      const { error } = await supabase.rpc('add_group_member_secure', {
        p_group: group.id,
        p_user: profile.id,
      })
      if (error) throw error
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user?.id
      if (userId) await loadRoster(group, userId)
      setNotice(`${profile.username} added to ${group.name}.`)
    } catch (error) {
      console.error('[wavo] add group member', error)
      setNotice(error.message || `Could not add ${profile.username}.`)
    } finally {
      setAddingId(null)
    }
  }

  if (!hero || !spaceName) return null

  const entry = createPortal(
    <button className="gmm-entry" onClick={() => setOpen(true)} type="button" aria-label="View Space members">
      <Users size={17} />
      <span>{members.length ? `${members.length} member${members.length === 1 ? '' : 's'}` : 'Members'}</span>
    </button>,
    hero,
  )

  const modal = open ? createPortal(
    <div className="gmm-overlay" onClick={() => setOpen(false)}>
      <section className="gmm-modal" role="dialog" aria-modal="true" aria-label={`${spaceName} members`} onClick={(event) => event.stopPropagation()}>
        <header className="gmm-header">
          <div className="gmm-title-wrap">
            <div className="gmm-icon"><Users size={20} /></div>
            <div>
              <span className="gmm-kicker">SPACE MEMBERS</span>
              <h2>{group?.name || spaceName}</h2>
              <p>{members.length} member{members.length === 1 ? '' : 's'} · You are {myRole || 'a member'}</p>
            </div>
          </div>
          <button className="gmm-close" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
        </header>

        {notice && <div className="gmm-notice">{notice}</div>}

        {canManage && (
          <section className="gmm-add-section">
            <div className="gmm-section-head">
              <div><UserPlus size={17} /><strong>Add people</strong></div>
              <span>Friends not already in this Space</span>
            </div>
            <label className="gmm-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search friends" />
            </label>
            <div className="gmm-candidate-list">
              {!loading && filteredCandidates.length === 0 && (
                <div className="gmm-empty">{candidates.length ? 'No friends match that search.' : 'All of your friends are already here.'}</div>
              )}
              {filteredCandidates.map((profile) => (
                <div className="gmm-person-row" key={profile.id}>
                  <div className="gmm-person-main">
                    <MemberAvatar profile={profile} />
                    <div><strong>{profile.username}</strong><span>{profile.status || 'Wavo friend'}</span></div>
                  </div>
                  <button className="gmm-add-button" disabled={addingId === profile.id} onClick={() => addMember(profile)}>
                    {addingId === profile.id ? 'Adding…' : <><UserPlus size={15} /> Add</>}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="gmm-members-section">
          <div className="gmm-section-head">
            <div><Users size={17} /><strong>Everyone here</strong></div>
            {canManage && <span>Owners and admins can add members</span>}
          </div>
          <div className="gmm-member-list">
            {loading && members.length === 0 && <div className="gmm-empty">Loading members…</div>}
            {members.map((member) => (
              <div className="gmm-person-row" key={member.user_id}>
                <div className="gmm-person-main">
                  <MemberAvatar profile={member.profile} />
                  <div><strong>{member.profile.username}</strong><span>{member.profile.status || 'Space member'}</span></div>
                </div>
                <RoleBadge role={member.role} />
              </div>
            ))}
          </div>
        </section>

        <footer className="gmm-footer">
          <Check size={15} /> Changes apply immediately to this Space.
        </footer>
      </section>
    </div>,
    document.body,
  ) : null

  return <>{entry}{modal}</>
}
