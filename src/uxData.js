import { supabase } from "./supabaseClient";

export async function getChatPins(userId) {
  const { data, error } = await supabase.from("chat_pins").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function setChatPinned(userId, kind, targetId, pinned) {
  const q = supabase.from("chat_pins");
  if (pinned) {
    const { error } = await q.upsert({ user_id: userId, kind, target_id: String(targetId) }, { onConflict: "user_id,kind,target_id" });
    if (error) throw error;
  } else {
    const { error } = await q.delete().eq("user_id", userId).eq("kind", kind).eq("target_id", String(targetId));
    if (error) throw error;
  }
}

export async function getNicknames(userId) {
  const { data, error } = await supabase.from("nicknames").select("*").eq("owner_id", userId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.target_id, row.nickname]));
}

export async function setNickname(userId, targetId, nickname) {
  const clean = nickname.trim();
  if (!clean) {
    const { error } = await supabase.from("nicknames").delete().eq("owner_id", userId).eq("target_id", targetId);
    if (error) throw error;
    return null;
  }
  const { data, error } = await supabase.from("nicknames").upsert({ owner_id: userId, target_id: targetId, nickname: clean }, { onConflict: "owner_id,target_id" }).select("*").single();
  if (error) throw error;
  return data;
}

export async function editDmMessage(userId, messageId, content) {
  const { data, error } = await supabase.from("messages").update({ content: content.trim(), edited_at: new Date().toISOString() }).eq("id", messageId).eq("sender_id", userId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteDmMessage(userId, messageId) {
  const { error } = await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId).eq("sender_id", userId);
  if (error) throw error;
}

export async function editSpaceMessage(userId, messageId, content) {
  const { data, error } = await supabase.from("group_messages").update({ content: content.trim(), edited_at: new Date().toISOString() }).eq("id", messageId).or(`sender_id.eq.${userId},user_id.eq.${userId}`).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteSpaceMessage(userId, messageId) {
  const { error } = await supabase.from("group_messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId).or(`sender_id.eq.${userId},user_id.eq.${userId}`);
  if (error) throw error;
}

export async function markDmRead(userId, friendId) {
  const chatId = [userId, friendId].sort().join("_");
  const { error } = await supabase.from("messages").update({ is_read: true, read_at: new Date().toISOString() }).eq("chat_id", chatId).eq("receiver_id", userId).eq("is_read", false);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  if (error) throw error;
}

export async function scheduleDmMessage(userId, friendId, content, sendAt) {
  const chatId = [userId, friendId].sort().join("_");
  const { data, error } = await supabase.from("scheduled_messages").insert({ sender_id: userId, kind: "dm", conversation_id: chatId, recipient_id: friendId, content: content.trim(), send_at: sendAt }).select("*").single();
  if (error) throw error;
  return data;
}

export async function getScheduledMessages(userId) {
  const { data, error } = await supabase.from("scheduled_messages").select("*").eq("sender_id", userId).is("delivered_at", null).order("send_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function cancelScheduledMessage(userId, id) {
  const { error } = await supabase.from("scheduled_messages").delete().eq("sender_id", userId).eq("id", id).is("delivered_at", null);
  if (error) throw error;
}
