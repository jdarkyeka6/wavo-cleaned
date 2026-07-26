from pathlib import Path

path = Path("src/App.jsx")
text = path.read_text(encoding="utf-8")


def once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


def exact_count(old: str, new: str, expected: int, label: str):
    global text
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    text = text.replace(old, new)


# Imports + CSS.
once(
'''import { useUrlSync } from "./useUrlSync";
import "./styles.css";''',
'''import { useUrlSync } from "./useUrlSync";
import { useSocialUpgrades } from "./useSocialUpgrades";
import {
  ProfileCardModal,
  MediaViewer,
  PinnedMessagesPanel,
  GroupManageModal,
} from "./SocialUpgrades";
import "./styles.css";
import "./social-upgrades.css";''',
"social imports",
)

# Overlay state.
once(
'''  // games
  const [showGames, setShowGames] = useState(false);

  // giphy''',
'''  // games
  const [showGames, setShowGames] = useState(false);

  // richer social surfaces
  const [profileUser, setProfileUser] = useState(null);
  const [mediaViewer, setMediaViewer] = useState(null);

  // giphy''',
"social overlay state",
)

# Social hook after chat id exists.
once(
'''  const chatId = useMemo(() => {
    if (!currentUser || !selectedUser) return null;
    return [currentUser.id, selectedUser.id].sort().join("_");
  }, [currentUser, selectedUser]);

  useEffect(() => {''',
'''  const chatId = useMemo(() => {
    if (!currentUser || !selectedUser) return null;
    return [currentUser.id, selectedUser.id].sort().join("_");
  }, [currentUser, selectedUser]);

  const {
    isChatPinned,
    toggleChatPin,
    resolvedPins,
    isMessagePinned,
    toggleMessagePin,
    pinsOpen,
    setPinsOpen,
    groupRole,
    canManageGroup,
    groupManageOpen,
    setGroupManageOpen,
    renameGroup,
    setMemberRole,
    removeMember,
    transferOwnership,
    deleteGroup,
  } = useSocialUpgrades({
    userId: currentUser?.id,
    chatId,
    selectedUser,
    selectedGroup,
    messages,
    groupMessages,
    groupMembers,
    loadGroups,
    loadGroupMembers,
    setSelectedGroup,
  });

  useEffect(() => {''',
"social hook",
)

# Jump from pinned panel to original message.
once(
'''  function jumpToLatest() {
    setStuckToBottom(true);
    scrollToBottom();
  }

  const unreadCount''',
'''  function jumpToLatest() {
    setStuckToBottom(true);
    scrollToBottom();
  }

  function jumpToPinned(msg) {
    if (!msg) return;
    setPinsOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(`msg-${msg.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  const unreadCount''',
"jump to pinned",
)

# Group members with roles. Gracefully fall back while the migration has not
# been applied to a preview database yet.
once(
'''  async function loadGroupMembers(gid) {
    const { data } = await supabase
      .from("group_members")
      .select("user_id, profiles(id, username, avatar_url, equipped_badge, equipped_name_style)")
      .eq("group_id", gid);
    if (data) {
      const map = {};
      data.forEach((row) => {
        if (row.profiles) map[row.profiles.id] = row.profiles;
      });
      setGroupMembers(map);
    }
  }''',
'''  async function loadGroupMembers(gid) {
    let { data, error } = await supabase
      .from("group_members")
      .select("user_id, role, profiles(id, username, avatar_url, status, created_at, equipped_badge, equipped_name_style)")
      .eq("group_id", gid);

    // Preview deployments may run before the migration is applied. Keep group
    // chat usable and infer only the creator role until the DB catches up.
    if (error) {
      const fallback = await supabase
        .from("group_members")
        .select("user_id, profiles(id, username, avatar_url, status, created_at, equipped_badge, equipped_name_style)")
        .eq("group_id", gid);
      data = fallback.data;
    }

    if (data) {
      const group = selectedGroup?.id === gid
        ? selectedGroup
        : groups.find((g) => g.id === gid);
      const map = {};
      data.forEach((row) => {
        if (row.profiles) {
          map[row.profiles.id] = {
            ...row.profiles,
            role: row.role || (row.profiles.id === group?.created_by ? "owner" : "member"),
          };
        }
      });
      setGroupMembers(map);
    }
  }''',
"group role loading",
)

# Owners must transfer ownership instead of orphaning a group.
once(
'''  async function leaveGroup() {
    if (!selectedGroup) return;
    if (!window.confirm(`Leave "${selectedGroup.name}"?`)) return;''',
'''  async function leaveGroup() {
    if (!selectedGroup) return;
    if (groupRole === "owner") {
      alert("Transfer ownership or delete the group before leaving.");
      setGroupManageOpen(true);
      return;
    }
    if (!window.confirm(`Leave "${selectedGroup.name}"?`)) return;''',
"owner leave guard",
)

# Own streak in the sidebar profile strip.
once(
'''          <div className="me-name">
            <strong>{profile?.username}</strong>
            <span>Profile &amp; settings</span>
          </div>
          <Settings size={17} className="me-gear" />''',
'''          <div className="me-name">
            <strong>{profile?.username}</strong>
            <span>Profile &amp; settings</span>
          </div>
          {stats?.current_streak > 0 && (
            <span className="streak-mini" title={`${stats.current_streak} day streak`}>
              🔥 {stats.current_streak}
            </span>
          )}
          <Settings size={17} className="me-gear" />''',
"sidebar streak",
)

# Search results can open profile pages.
once(
'''                  <Avatar url={u.avatar_url} name={u.username} size="sm" />
                  <strong>{u.username}</strong>''',
'''                  <Avatar url={u.avatar_url} name={u.username} size="sm" />
                  <button
                    type="button"
                    className="profile-open-btn"
                    onClick={() => setProfileUser(u)}
                    title={`View ${u.username}'s profile`}
                  >
                    <strong>{u.username}</strong>
                  </button>''',
"search profile link",
)

# Pinned chats sort to the top.
once(
'''            {groups.map((g) => (''',
'''            {groups
              .slice()
              .sort((a, b) => Number(isChatPinned("group", b.id)) - Number(isChatPinned("group", a.id)))
              .map((g) => (''',
"group pin sort",
)
once(
'''                  <span className="user-status">Group</span>
                </div>
              </button>''',
'''                  <span className="user-status">Group</span>
                </div>
                {isChatPinned("group", g.id) && <span className="streak-mini">📌</span>}
              </button>''',
"group pin badge",
)
once(
'''          {friends.filter((u) => !blockedIds.has(u.id)).map((u) => (''',
'''          {friends
            .filter((u) => !blockedIds.has(u.id))
            .slice()
            .sort((a, b) => Number(isChatPinned("dm", b.id)) - Number(isChatPinned("dm", a.id)))
            .map((u) => (''',
"friend pin sort",
)
once(
'''              {unreadByUser[u.id] > 0 && (
                <span className="user-badge">{unreadByUser[u.id]}</span>
              )}''',
'''              {isChatPinned("dm", u.id) && <span className="streak-mini">📌</span>}
              {unreadByUser[u.id] > 0 && (
                <span className="user-badge">{unreadByUser[u.id]}</span>
              )}''',
"friend pin badge",
)

# Profile page from DM header.
once(
'''                  <h3>
                    {displayName(selectedUser)}
                    <button''',
'''                  <h3>
                    <button
                      className="profile-open-btn"
                      onClick={() => setProfileUser(selectedUser)}
                      title="View profile"
                    >
                      {displayName(selectedUser)}
                    </button>
                    <button''',
"dm profile header",
)

# DM header: pinned chat + pinned-message drawer.
once(
'''              <div className="chat-header-right">
                <button
                  className={`icon-btn ${showSearch ? "active" : ""}`}''',
'''              <div className="chat-header-right">
                <button
                  className={`icon-btn ${isChatPinned("dm", selectedUser.id) ? "active" : ""}`}
                  onClick={() => toggleChatPin("dm", selectedUser.id)}
                  aria-label="Pin this chat"
                  title={isChatPinned("dm", selectedUser.id) ? "Unpin chat" : "Pin chat"}
                >
                  📌
                </button>
                <button
                  className={`icon-btn ${pinsOpen ? "active" : ""}`}
                  onClick={() => setPinsOpen((v) => !v)}
                  aria-label="Pinned messages"
                  title="Pinned messages"
                >
                  📍{resolvedPins.length ? resolvedPins.length : ""}
                </button>
                <button
                  className={`icon-btn ${showSearch ? "active" : ""}`}''',
"dm header pins",
)

# View profile in overflow menu too.
once(
'''                    <div className="chat-menu">
                      <button
                        onClick={() => {
                          setShowChatMenu(false);
                          setNickname(selectedUser);''',
'''                    <div className="chat-menu">
                      <button
                        onClick={() => {
                          setShowChatMenu(false);
                          setProfileUser(selectedUser);
                        }}
                      >
                        👤 View profile
                      </button>
                      <button
                        onClick={() => {
                          setShowChatMenu(false);
                          setNickname(selectedUser);''',
"dm profile menu",
)

# Pinned drawer is valid for both DM and group message panes.
exact_count(
'''            <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>''',
'''            {pinsOpen && (
              <PinnedMessagesPanel
                pins={resolvedPins}
                onClose={() => setPinsOpen(false)}
                onJump={jumpToPinned}
                onTogglePin={toggleMessagePin}
              />
            )}
            <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>''',
2,
"pinned panels",
)

# Give messages stable DOM anchors for jump-to-pin.
exact_count(
'''                  <div
                    className={`bubble-wrap ${mine ? "mine" : "theirs"} ${''',
'''                  <div
                    id={`msg-${msg.id}`}
                    className={`bubble-wrap ${mine ? "mine" : "theirs"} ${''',
2,
"message anchors",
)

# Images open the real media viewer in both DM and group chats.
exact_count(
'''                          className="msg-image"
                          src={msg.content}
                          alt="image"
                          loading="lazy"
                        />''',
'''                          className="msg-image"
                          src={msg.content}
                          alt="image"
                          loading="lazy"
                          onClick={() =>
                            setMediaViewer({
                              activeId: msg.id,
                              media: selectedGroup ? groupMessages : messages,
                            })
                          }
                        />''',
2,
"media viewer images",
)

# DM message pinning.
once(
'''                            <button onClick={() => startReply(msg)}>↩ Reply</button>
                            {mine && msg.type === "text" && (''',
'''                            <button onClick={() => startReply(msg)}>↩ Reply</button>
                            <button
                              onClick={() => {
                                setReactPickerMsg(null);
                                toggleMessagePin(msg);
                              }}
                            >
                              📌 {isMessagePinned(msg.id) ? "Unpin" : "Pin message"}
                            </button>
                            {mine && msg.type === "text" && (''',
"dm message pin action",
)

# Group message pinning, admins/owner only.
once(
'''                            <button onClick={() => startReply(msg)}>
                              ↩ Reply
                            </button>
                            {mine && msg.type === "text" && (''',
'''                            <button onClick={() => startReply(msg)}>
                              ↩ Reply
                            </button>
                            {canManageGroup && (
                              <button
                                onClick={() => {
                                  setReactPickerMsg(null);
                                  toggleMessagePin(msg);
                                }}
                              >
                                📌 {isMessagePinned(msg.id) ? "Unpin" : "Pin message"}
                              </button>
                            )}
                            {mine && msg.type === "text" && (''',
"group message pin action",
)

# Group role in header.
once(
'''                    {Object.keys(groupMembers).length === 1 ? "" : "s"}
                    {groupTyping ? ` · ${groupTyping} is typing…` : ""}''',
'''                    {Object.keys(groupMembers).length === 1 ? "" : "s"}
                    {groupRole ? ` · ${groupRole}` : ""}
                    {groupTyping ? ` · ${groupTyping} is typing…` : ""}''',
"group role header",
)

# Group header controls.
once(
'''                </div>
                <button
                  className="report-user-btn"
                  onClick={leaveGroup}
                  title="Leave group"''',
'''                </div>
                <button
                  className={`icon-btn ${isChatPinned("group", selectedGroup.id) ? "active" : ""}`}
                  onClick={() => toggleChatPin("group", selectedGroup.id)}
                  aria-label="Pin this group"
                  title={isChatPinned("group", selectedGroup.id) ? "Unpin group" : "Pin group"}
                >
                  📌
                </button>
                <button
                  className={`icon-btn ${pinsOpen ? "active" : ""}`}
                  onClick={() => setPinsOpen((v) => !v)}
                  aria-label="Pinned messages"
                  title="Pinned messages"
                >
                  📍{resolvedPins.length ? resolvedPins.length : ""}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setGroupManageOpen(true)}
                  aria-label="Group settings"
                  title="Group members & roles"
                >
                  ⚙️
                </button>
                <button
                  className="report-user-btn"
                  onClick={leaveGroup}
                  title="Leave group"''',
"group header controls",
)

# Global overlays before the existing Premium overlay.
once(
'''      <Premium
        open={showPremium}''',
'''      {profileUser && (
        <ProfileCardModal
          user={profileUser}
          onClose={() => setProfileUser(null)}
          isFriend={friends.some((f) => f.id === profileUser.id)}
          onMessage={openChat}
          onAdd={sendRequest}
          onBlock={blockUser}
          onReport={reportUser}
        />
      )}

      {mediaViewer && (
        <MediaViewer
          media={mediaViewer.media}
          activeId={mediaViewer.activeId}
          onClose={() => setMediaViewer(null)}
        />
      )}

      {groupManageOpen && selectedGroup && (
        <GroupManageModal
          group={selectedGroup}
          members={groupMembers}
          myRole={groupRole}
          onClose={() => setGroupManageOpen(false)}
          onRename={renameGroup}
          onSetRole={setMemberRole}
          onRemove={removeMember}
          onTransfer={transferOwnership}
          onDelete={deleteGroup}
          onProfile={setProfileUser}
        />
      )}

      <Premium
        open={showPremium}''',
"global social overlays",
)

path.write_text(text, encoding="utf-8")
print("Applied Wavo social upgrades integration patch")
