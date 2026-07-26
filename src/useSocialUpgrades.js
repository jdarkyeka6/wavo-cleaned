import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const pinKey = (kind, id) => `${kind}:${String(id)}`;

export function useSocialUpgrades({
  userId,
  chatId,
  selectedUser,
  selectedGroup,
  messages,
  groupMessages,
  groupMembers,
  loadGroups,
  loadGroupMembers,
  setSelectedGroup,
}) {
  const [chatPins, setChatPins] = useState(new Set());
  const [messagePins, setMessagePins] = useState([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [groupManageOpen, setGroupManageOpen] = useState(false);

  const groupRole = selectedGroup ? groupMembers?.[userId]?.role || "member" : null;
  const canManageGroup = groupRole === "owner" || groupRole === "admin";
  const isGroupOwner = groupRole === "owner";

  const loadChatPins = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("chat_pins")
      .select("kind,target_id")
      .eq("user_id", userId);
    if (error) {
      console.warn("Couldn't load chat pins", error.message);
      return;
    }
    setChatPins(new Set((data || []).map((p) => pinKey(p.kind, p.target_id))));
  }, [userId]);

  useEffect(() => {
    loadChatPins();
  }, [loadChatPins]);

  const currentKind = selectedGroup ? "group" : selectedUser ? "dm" : null;
  const currentConversationId = selectedGroup?.id ? String(selectedGroup.id) : chatId || null;

  const loadMessagePins = useCallback(async () => {
    if (!currentKind || !currentConversationId) {
      setMessagePins([]);
      return;
    }
    const { data, error } = await supabase.rpc("get_message_pins", {
      p_kind: currentKind,
      p_conversation_id: String(currentConversationId),
    });
    if (error) {
      console.warn("Couldn't load message pins", error.message);
      setMessagePins([]);
      return;
    }
    setMessagePins(data || []);
  }, [currentKind, currentConversationId]);

  useEffect(() => {
    setPinsOpen(false);
    loadMessagePins();
  }, [loadMessagePins]);

  async function toggleChatPin(kind, targetId) {
    if (!userId || !targetId) return;
    const key = pinKey(kind, targetId);
    const exists = chatPins.has(key);
    setChatPins((prev) => {
      const next = new Set(prev);
      if (exists) next.delete(key);
      else next.add(key);
      return next;
    });

    const query = exists
      ? supabase.from("chat_pins").delete().eq("user_id", userId).eq("kind", kind).eq("target_id", String(targetId))
      : supabase.from("chat_pins").insert({ user_id: userId, kind, target_id: String(targetId) });
    const { error } = await query;
    if (error) {
      await loadChatPins();
      alert("Couldn't update pinned chats: " + error.message);
    }
  }

  function isChatPinned(kind, targetId) {
    return chatPins.has(pinKey(kind, targetId));
  }

  async function toggleMessagePin(msg) {
    if (!msg || !currentKind || !currentConversationId) return;
    const { error } = await supabase.rpc("toggle_message_pin", {
      p_kind: currentKind,
      p_conversation_id: String(currentConversationId),
      p_message_id: String(msg.id),
    });
    if (error) {
      alert("Couldn't pin message: " + error.message);
      return;
    }
    await loadMessagePins();
  }

  const resolvedPins = useMemo(() => {
    const source = selectedGroup ? groupMessages : messages;
    const byId = new Map((source || []).map((m) => [String(m.id), m]));
    return messagePins.map((pin) => ({ ...pin, message: byId.get(String(pin.message_id)) || null }));
  }, [messagePins, messages, groupMessages, selectedGroup]);

  function isMessagePinned(msgId) {
    return messagePins.some((p) => String(p.message_id) === String(msgId));
  }

  async function renameGroup() {
    if (!selectedGroup || !canManageGroup) return;
    const next = window.prompt("Rename group", selectedGroup.name);
    if (next === null || !next.trim() || next.trim() === selectedGroup.name) return;
    const { error } = await supabase.rpc("rename_group_secure", {
      p_group: selectedGroup.id,
      p_name: next.trim(),
    });
    if (error) return alert("Couldn't rename group: " + error.message);
    setSelectedGroup({ ...selectedGroup, name: next.trim() });
    await loadGroups?.();
  }

  async function setMemberRole(memberId, role) {
    if (!selectedGroup || !isGroupOwner) return;
    const { error } = await supabase.rpc("set_group_role", {
      p_group: selectedGroup.id,
      p_user: memberId,
      p_role: role,
    });
    if (error) return alert("Couldn't change role: " + error.message);
    await loadGroupMembers?.(selectedGroup.id);
  }

  async function removeMember(memberId, username) {
    if (!selectedGroup || !canManageGroup) return;
    if (!window.confirm(`Remove ${username || "this member"} from the group?`)) return;
    const { error } = await supabase.rpc("remove_group_member_secure", {
      p_group: selectedGroup.id,
      p_user: memberId,
    });
    if (error) return alert("Couldn't remove member: " + error.message);
    await loadGroupMembers?.(selectedGroup.id);
  }

  async function transferOwnership(memberId, username) {
    if (!selectedGroup || !isGroupOwner) return;
    if (!window.confirm(`Make ${username || "this member"} the new owner? You will become a member.`)) return;
    const { error } = await supabase.rpc("transfer_group_ownership", {
      p_group: selectedGroup.id,
      p_user: memberId,
    });
    if (error) return alert("Couldn't transfer ownership: " + error.message);
    await loadGroupMembers?.(selectedGroup.id);
  }

  async function deleteGroup() {
    if (!selectedGroup || !isGroupOwner) return;
    if (!window.confirm(`Delete “${selectedGroup.name}”? This cannot be undone.`)) return;
    const typed = window.prompt('Type DELETE to permanently delete this group.');
    if (typed !== "DELETE") return;
    const { error } = await supabase.rpc("delete_group_secure", { p_group: selectedGroup.id });
    if (error) return alert("Couldn't delete group: " + error.message);
    setGroupManageOpen(false);
    setSelectedGroup(null);
    await loadGroups?.();
  }

  return {
    chatPins,
    isChatPinned,
    toggleChatPin,
    messagePins,
    resolvedPins,
    isMessagePinned,
    toggleMessagePin,
    loadMessagePins,
    pinsOpen,
    setPinsOpen,
    groupRole,
    canManageGroup,
    isGroupOwner,
    groupManageOpen,
    setGroupManageOpen,
    renameGroup,
    setMemberRole,
    removeMember,
    transferOwnership,
    deleteGroup,
  };
}
