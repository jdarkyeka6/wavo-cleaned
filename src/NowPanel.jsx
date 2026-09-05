import { EyeOff, Gamepad2, Music2, Radio, ShieldCheck, Users } from 'lucide-react'

function initial(name = 'W') {
  return name.trim().slice(0, 1).toUpperCase() || 'W'
}

function MiniAvatar({ person }) {
  return (
    <span className="next-avatar" aria-hidden="true">
      {person?.avatar_url ? <img src={person.avatar_url} alt="" /> : initial(person?.username)}
    </span>
  )
}

function activityText(group) {
  const status = group.status?.payload?.text
  const spotify = group.spotify?.payload
  const gaming = group.gaming?.payload
  if (spotify?.track) return `Listening to ${spotify.track}${spotify.artist ? ` · ${spotify.artist}` : ''}`
  if (gaming?.name) return `Playing ${gaming.name}`
  if (status) return status
  return 'Active now'
}

function ActivityIcon({ group }) {
  if (group.spotify) return <Music2 size={15} />
  if (group.gaming) return <Gamepad2 size={15} />
  return <Radio size={15} />
}

export function NowPanel({ friends = [], rows = [], onOpenFriend }) {
  const friendMap = new Map(friends.map((friend) => [friend.id, friend]))
  const grouped = new Map()

  for (const row of rows) {
    const person = friendMap.get(row.owner_id)
    if (!person) continue
    if (!grouped.has(row.owner_id)) grouped.set(row.owner_id, { person })
    grouped.get(row.owner_id)[row.kind] = row
  }

  const people = [...grouped.values()]
    .filter((group) => group.presence || group.status || group.spotify || group.gaming)
    .slice(0, 12)

  return (
    <section className="next-now-card">
      <div className="next-section-head">
        <div>
          <span className="eyebrow">NOW</span>
          <h2>Your people</h2>
        </div>
        <span className="next-live-pill"><i />{people.length} sharing</span>
      </div>

      {people.length ? (
        <div className="next-now-rail">
          {people.map((group) => (
            <button key={group.person.id} className="next-now-person" onClick={() => onOpenFriend?.(group.person)}>
              <span className="next-avatar-wrap">
                <MiniAvatar person={group.person} />
                {group.presence && <i className="next-online-dot" />}
              </span>
              <strong>{group.person.username}</strong>
              <span><ActivityIcon group={group} /> {activityText(group)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="next-now-empty">
          <Users size={20} />
          <div><strong>Quiet right now</strong><span>Activity only appears when your friends chose to share it with you.</span></div>
        </div>
      )}
    </section>
  )
}

function SettingToggle({ label, description, value, onChange, disabled = false }) {
  return (
    <button type="button" className="next-setting-toggle" onClick={() => !disabled && onChange(!value)} disabled={disabled}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <i className={value ? 'next-switch on' : 'next-switch'}><b /></i>
    </button>
  )
}

export function ActivitySharingSettings({ friends = [], sharing, onChange, busy = false }) {
  if (!sharing) return null
  const audience = sharing.audience || []

  function toggleAudience(id) {
    const next = audience.includes(id) ? audience.filter((value) => value !== id) : [...audience, id]
    onChange({ audience: next })
  }

  return (
    <section className="settings-card next-sharing-card">
      <div className="settings-head">
        <ShieldCheck />
        <div>
          <strong>Activity sharing</strong>
          <span>Set it once. Wavo only shows these signals to the friends you choose.</span>
        </div>
      </div>

      <SettingToggle
        label="Invisible mode"
        description="Temporarily share nothing without deleting your setup."
        value={sharing.invisible}
        onChange={(value) => onChange({ invisible: value })}
      />
      <SettingToggle
        label="Presence"
        description="Show when Wavo is open and active."
        value={sharing.share_presence}
        onChange={(value) => onChange({ share_presence: value })}
      />
      <SettingToggle
        label="Status"
        description="Share the status you set on your Wavo profile."
        value={sharing.share_status}
        onChange={(value) => onChange({ share_status: value })}
      />
      <SettingToggle
        label="Spotify"
        description="Share the track you are listening to after connecting Spotify below."
        value={sharing.share_spotify}
        onChange={(value) => onChange({ share_spotify: value })}
      />
      <SettingToggle
        label="Gaming"
        description="Ready for explicit game integrations, never background app snooping."
        value={sharing.share_gaming}
        onChange={(value) => onChange({ share_gaming: value })}
      />

      <div className="next-audience-block">
        <div className="next-audience-head">
          <div><strong>Share activity with</strong><span>{audience.length} selected</span></div>
          {audience.length > 0 && <button type="button" onClick={() => onChange({ audience: [] })}>Clear</button>}
        </div>
        {friends.length ? (
          <div className="next-audience-grid">
            {friends.map((friend) => {
              const selected = audience.includes(friend.id)
              return (
                <button type="button" key={friend.id} className={selected ? 'selected' : ''} onClick={() => toggleAudience(friend.id)} disabled={busy}>
                  <MiniAvatar person={friend} />
                  <span>{friend.username}</span>
                  <i>{selected ? '✓' : '+'}</i>
                </button>
              )
            })}
          </div>
        ) : <div className="form-note">Add friends first, then choose who can see your activity.</div>}
      </div>

      <p className="next-privacy-foot"><EyeOff size={14} /> Wavo stores only the latest short-lived activity state here, not an activity history.</p>
    </section>
  )
}
