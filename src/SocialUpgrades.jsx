import { useEffect, useMemo, useState } from "react";
import {
  X,
  Pin,
  MessageCircle,
  UserPlus,
  Ban,
  Flag,
  Crown,
  ShieldCheck,
  User,
  Download,
  ChevronLeft,
  ChevronRight,
  Settings,
  Trash2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { UserLabel } from "./Cosmetic";

const initial = (name) => (name?.trim()?.[0] || "?").toUpperCase();

function Avatar({ url, name, size = "lg" }) {
  return (
    <div className={`social-avatar ${size}`}>
      {url ? <img src={url} alt="" /> : initial(name)}
    </div>
  );
}

export function ProfileCardModal({
  user,
  onClose,
  isFriend = false,
  onMessage,
  onAdd,
  onBlock,
  onReport,
}) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setCard(null);
    if (!user?.id) return;
    supabase.rpc("get_profile_card", { p_user: user.id }).then(({ data }) => {
      if (!live) return;
      setCard(data || user);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [user?.id]);

  if (!user) return null;
  const p = card || user;

  return (
    <div className="social-overlay" onClick={onClose}>
      <div className="profile-card-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="social-close" onClick={onClose} aria-label="Close profile">
          <X size={19} />
        </button>

        <div className="profile-hero">
          <Avatar url={p.avatar_url} name={p.username} />
          <div>
            <h2><UserLabel user={p} name={p.username} /></h2>
            <p>{p.status || "No status yet"}</p>
          </div>
        </div>

        {loading ? (
          <div className="profile-loading">Loading profile…</div>
        ) : (
          <>
            <div className="profile-stats-grid">
              <div><strong>🔥 {p.current_streak || 0}</strong><span>day streak</span></div>
              <div><strong>{p.longest_streak || 0}</strong><span>best streak</span></div>
              <div><strong>{p.messages_sent || 0}</strong><span>messages</span></div>
              <div><strong>{p.mutual_friends || 0}</strong><span>mutual friends</span></div>
            </div>
            {p.created_at && (
              <div className="profile-member-since">
                Joined {new Date(p.created_at).toLocaleDateString()}
              </div>
            )}
          </>
        )}

        <div className="profile-actions">
          {isFriend && onMessage && (
            <button className="social-primary" onClick={() => { onClose(); onMessage(user); }}>
              <MessageCircle size={16} /> Message
            </button>
          )}
          {!isFriend && onAdd && (
            <button className="social-primary" onClick={() => onAdd(user.id)}>
              <UserPlus size={16} /> Add friend
            </button>
          )}
          {onReport && (
            <button onClick={() => onReport(user)}><Flag size={15} /> Report</button>
          )}
          {onBlock && (
            <button className="danger" onClick={() => onBlock(user)}><Ban size={15} /> Block</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaViewer({ media, activeId, onClose }) {
  const items = useMemo(() => (media || []).filter((m) => m?.type === "image" && !m.deleted_at), [media]);
  const initialIndex = Math.max(0, items.findIndex((m) => String(m.id) === String(activeId)));
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => setIndex(initialIndex), [initialIndex, activeId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  const current = items[index];
  if (!current) return null;

  return (
    <div className="media-viewer" onClick={onClose} role="dialog" aria-modal="true">
      <div className="media-viewer-toolbar" onClick={(e) => e.stopPropagation()}>
        <span>{index + 1} / {items.length}</span>
        <a href={current.content} target="_blank" rel="noreferrer" download title="Open/download image">
          <Download size={18} />
        </a>
        <button onClick={onClose} aria-label="Close"><X size={21} /></button>
      </div>

      {index > 0 && (
        <button className="media-nav prev" onClick={(e) => { e.stopPropagation(); setIndex(index - 1); }} aria-label="Previous image">
          <ChevronLeft size={30} />
        </button>
      )}
      <img className="media-viewer-image" src={current.content} alt="Shared media" onClick={(e) => e.stopPropagation()} />
      {index < items.length - 1 && (
        <button className="media-nav next" onClick={(e) => { e.stopPropagation(); setIndex(index + 1); }} aria-label="Next image">
          <ChevronRight size={30} />
        </button>
      )}
      <div className="media-caption" onClick={(e) => e.stopPropagation()}>
        {new Date(current.created_at).toLocaleString()}
      </div>
    </div>
  );
}

export function PinnedMessagesPanel({ pins, onClose, onJump, onTogglePin }) {
  return (
    <div className="pins-panel">
      <div className="pins-panel-head">
        <div><Pin size={16} /><strong>Pinned messages</strong></div>
        <button onClick={onClose} aria-label="Close pinned messages"><X size={17} /></button>
      </div>
      <div className="pins-panel-list">
        {pins.length === 0 && <div className="pins-empty">Nothing pinned yet.</div>}
        {pins.map((pin) => {
          const msg = pin.message;
          return (
            <div className="pin-row" key={pin.id}>
              <button className="pin-jump" onClick={() => msg && onJump(msg)} disabled={!msg}>
                <span className="pin-preview">
                  {!msg ? "Pinned message isn't loaded" : msg.deleted_at ? "Message removed" : msg.type === "image" ? "📷 Image" : msg.type === "file" ? `📄 ${msg.file_name || "File"}` : msg.content}
                </span>
                <span>{new Date(pin.created_at).toLocaleDateString()}</span>
              </button>
              {msg && <button className="pin-remove" onClick={() => onTogglePin(msg)} title="Unpin"><X size={14} /></button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoleIcon({ role }) {
  if (role === "owner") return <Crown size={14} />;
  if (role === "admin") return <ShieldCheck size={14} />;
  return <User size={14} />;
}

export function GroupManageModal({
  group,
  members,
  myRole,
  onClose,
  onRename,
  onSetRole,
  onRemove,
  onTransfer,
  onDelete,
  onProfile,
}) {
  if (!group) return null;
  const isOwner = myRole === "owner";
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <div className="social-overlay" onClick={onClose}>
      <div className="group-manage-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <div><Settings size={18} /><div><h3>{group.name}</h3><span>Your role: {myRole || "member"}</span></div></div>
          <button className="social-close inline" onClick={onClose}><X size={18} /></button>
        </header>

        {canManage && <button className="group-rename" onClick={onRename}>Rename group</button>}

        <h4>Members</h4>
        <div className="group-member-list">
          {Object.values(members || {}).map((m) => (
            <div className="group-manage-row" key={m.id}>
              <button className="member-profile" onClick={() => onProfile?.(m)}>
                <Avatar url={m.avatar_url} name={m.username} size="sm" />
                <div><strong>{m.username}</strong><span><RoleIcon role={m.role} /> {m.role || "member"}</span></div>
              </button>
              <div className="member-role-actions">
                {isOwner && m.role !== "owner" && (
                  <button onClick={() => onSetRole(m.id, m.role === "admin" ? "member" : "admin")}>{m.role === "admin" ? "Demote" : "Make admin"}</button>
                )}
                {isOwner && m.role !== "owner" && (
                  <button onClick={() => onTransfer(m.id, m.username)}>Make owner</button>
                )}
                {canManage && m.role !== "owner" && !(myRole === "admin" && m.role === "admin") && (
                  <button className="danger" onClick={() => onRemove(m.id, m.username)}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {isOwner && (
          <div className="group-danger-zone">
            <button className="danger" onClick={onDelete}><Trash2 size={15} /> Delete group</button>
          </div>
        )}
      </div>
    </div>
  );
}
