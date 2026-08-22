import { supabase } from "./supabaseClient";

const uniq = (items, key = "id") => {
  const map = new Map();
  items.filter(Boolean).forEach((item) => map.set(item[key], item));
  return [...map.values()];
};

export async function getProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

export async function getFriends(userId) {
  const { data: links, error } = await supabase
    .from("friend_requests")
    .select("id,sender_id,receiver_id,status")
    .eq("status", "accepted")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (error) throw error;
  const ids = [...new Set((links || []).map((r) => (r.sender_id === userId ? r.receiver_id : r.sender_id)))];
  if (!ids.length) return [];
  const { data, error: profileError } = await supabase.from("profiles").select("*").in("id", ids);
  if (profileError) throw profileError;
  return data || [];
}

export async function getIncomingFriendRequests(userId) {
  const { data: requests, error } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const senderIds = [...new Set((requests || []).map((r) => r.sender_id))];
  if (!senderIds.length) return [];
  const { data: profiles, error: pError } = await supabase.from("profiles").select("*").in("id", senderIds);
  if (pError) throw pError;
  const map = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  return (requests || []).map((request) => ({ ...request, sender: map[request.sender_id] }));
}

export async function searchProfiles(query, userId) {
  const term = query.trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,avatar_url,status,last_active,bio")
    .ilike("username", `%${term}%`)
    .neq("id", userId)
    .limit(12);
  if (error) throw error;
  return data || [];
}

export async function sendFriendRequest(senderId, receiverId) {
  const { error } = await supabase.from("friend_requests").insert({ sender_id: senderId, receiver_id: receiverId, status: "pending" });
  if (error && error.code !== "23505") throw error;
}

export async function respondFriendRequest(requestId, status) {
  const { error } = await supabase.from("friend_requests").update({ status }).eq("id", requestId);
  if (error) throw error;
}

export async function getSpaces(userId) {
  const [{ data: memberships, error: memberError }, { data: owned, error: ownedError }] = await Promise.all([
    supabase.from("group_members").select("group_id,role").eq("user_id", userId),
    supabase.from("groups").select("*").eq("created_by", userId),
  ]);
  if (memberError) throw memberError;
  if (ownedError) throw ownedError;
  const ids = [...new Set((memberships || []).map((m) => m.group_id).filter(Boolean))];
  let memberGroups = [];
  if (ids.length) {
    const { data, error } = await supabase.from("groups").select("*").in("id", ids);
    if (error) throw error;
    memberGroups = data || [];
  }
  const roles = Object.fromEntries((memberships || []).map((m) => [m.group_id, m.role]));
  return uniq([...(owned || []), ...memberGroups]).map((g) => ({ ...g, role: roles[g.id] || (g.created_by === userId ? "owner" : "member") }));
}

export async function createSpace(userId, { name, description, emoji }) {
  const { data, error } = await supabase
    .from("groups")
    .insert({ name: name.trim(), description: description?.trim() || null, emoji: emoji || "🌊", created_by: userId })
    .select("*")
    .single();
  if (error) throw error;
  const { error: memberError } = await supabase.from("group_members").insert({ group_id: data.id, user_id: userId, role: "owner" });
  if (memberError && memberError.code !== "23505") throw memberError;
  return data;
}

export async function getSpaceMessages(groupId) {
  const { data, error } = await supabase.from("group_messages").select("*").eq("group_id", groupId).order("created_at", { ascending: true }).limit(300);
  if (error) throw error;
  const ids = [...new Set((data || []).map((m) => m.sender_id || m.user_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id || "")))];
  let profiles = [];
  if (ids.length) {
    const { data: p, error: pError } = await supabase.from("profiles").select("id,username,avatar_url").in("id", ids);
    if (pError) throw pError;
    profiles = p || [];
  }
  const map = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return (data || []).map((m) => ({ ...m, sender: map[m.sender_id || m.user_id] }));
}

export async function sendSpaceMessage(groupId, userId, content) {
  const { error } = await supabase.from("group_messages").insert({
    group_id: groupId,
    user_id: userId,
    sender_id: userId,
    content: content.trim(),
    type: "text",
  });
  if (error) throw error;
}

export async function getWaves() {
  const { data: waves, error } = await supabase
    .from("waves")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  const authorIds = [...new Set((waves || []).map((w) => w.author_id))];
  const waveIds = (waves || []).map((w) => w.id);
  const [profilesResult, reactionsResult] = await Promise.all([
    authorIds.length ? supabase.from("profiles").select("id,username,avatar_url,status").in("id", authorIds) : Promise.resolve({ data: [] }),
    waveIds.length ? supabase.from("wave_reactions").select("*").in("wave_id", waveIds) : Promise.resolve({ data: [] }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (reactionsResult.error) throw reactionsResult.error;
  const profileMap = Object.fromEntries((profilesResult.data || []).map((p) => [p.id, p]));
  const reactions = reactionsResult.data || [];
  return (waves || []).map((wave) => ({
    ...wave,
    author: profileMap[wave.author_id],
    reactions: reactions.filter((r) => r.wave_id === wave.id),
  }));
}

export async function createWave(userId, { body, audience = "friends", groupId = null, recipients = [] }) {
  const { data, error } = await supabase
    .from("waves")
    .insert({ author_id: userId, kind: "text", body: body.trim(), audience, group_id: groupId, recipient_ids: recipients })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function reactToWave(userId, waveId, emoji) {
  const { error } = await supabase.from("wave_reactions").insert({ wave_id: waveId, user_id: userId, emoji });
  if (error && error.code !== "23505") throw error;
}

export async function getPlans(userId, spaces) {
  const groupIds = (spaces || []).map((g) => g.id);
  const queries = [supabase.from("plans").select("*").eq("created_by", userId).eq("cancelled", false)];
  if (groupIds.length) queries.push(supabase.from("plans").select("*").in("group_id", groupIds).eq("cancelled", false));
  const results = await Promise.all(queries);
  results.forEach((r) => { if (r.error) throw r.error; });
  const plans = uniq(results.flatMap((r) => r.data || [])).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);
  const { data: rsvps, error } = await supabase.from("plan_rsvps").select("*").in("plan_id", ids);
  if (error) throw error;
  return plans.map((plan) => ({ ...plan, rsvps: (rsvps || []).filter((r) => r.plan_id === plan.id) }));
}

export async function createPlan(userId, { groupId, title, location, startsAt, notes }) {
  const { data, error } = await supabase
    .from("plans")
    .insert({ group_id: groupId, created_by: userId, title: title.trim(), location: location?.trim() || null, place_name: location?.trim() || null, starts_at: startsAt, notes: notes?.trim() || null, cancelled: false })
    .select("*")
    .single();
  if (error) throw error;
  await setRsvp(userId, data.id, "going");
  return data;
}

export async function setRsvp(userId, planId, response) {
  const { error } = await supabase.from("plan_rsvps").upsert({ plan_id: planId, user_id: userId, response, responded_at: new Date().toISOString() }, { onConflict: "plan_id,user_id" });
  if (error) throw error;
}

export async function getPolls() {
  const { data: polls, error } = await supabase.from("polls").select("*").order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  if (!polls?.length) return [];
  const ids = polls.map((p) => p.id);
  const [{ data: options, error: oError }, { data: votes, error: vError }] = await Promise.all([
    supabase.from("poll_options").select("*").in("poll_id", ids).order("position"),
    supabase.from("poll_votes").select("*").in("poll_id", ids),
  ]);
  if (oError) throw oError;
  if (vError) throw vError;
  return polls.map((poll) => ({ ...poll, options: (options || []).filter((o) => o.poll_id === poll.id), votes: (votes || []).filter((v) => v.poll_id === poll.id) }));
}

export async function createPoll(userId, { groupId, question, options }) {
  const { data: poll, error } = await supabase.from("polls").insert({ created_by: userId, group_id: groupId, question: question.trim() }).select("*").single();
  if (error) throw error;
  const rows = options.map((label, position) => ({ poll_id: poll.id, label: label.trim(), position })).filter((o) => o.label);
  const { error: optionError } = await supabase.from("poll_options").insert(rows);
  if (optionError) throw optionError;
  return poll;
}

export async function votePoll(userId, poll, optionId) {
  if (!poll.allow_multiple) {
    const { error: deleteError } = await supabase.from("poll_votes").delete().eq("poll_id", poll.id).eq("user_id", userId);
    if (deleteError) throw deleteError;
  }
  const { error } = await supabase.from("poll_votes").insert({ poll_id: poll.id, option_id: optionId, user_id: userId });
  if (error && error.code !== "23505") throw error;
}

export async function getActivities() {
  const { data, error } = await supabase.from("activities").select("*").eq("active", true).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export async function createActivity(userId, { groupId, type, title, items = [] }) {
  const { data, error } = await supabase
    .from("activities")
    .insert({ created_by: userId, group_id: groupId, type, title: title.trim(), state: { items } })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getPrivacySettings(userId) {
  const { data, error } = await supabase.from("privacy_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: createError } = await supabase.from("privacy_settings").insert({ user_id: userId }).select("*").single();
  if (createError) throw createError;
  return created;
}

export async function updatePrivacySettings(userId, patch) {
  const { data, error } = await supabase
    .from("privacy_settings")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function sharePlanLocation(userId, planId, { latitude, longitude, precisionM = 250, minutes = 60 }) {
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("location_shares")
    .insert({ owner_id: userId, plan_id: planId, latitude, longitude, precision_m: precisionM, expires_at: expiresAt })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function stopAllLocationSharing(userId) {
  const { error } = await supabase.from("location_shares").delete().eq("owner_id", userId);
  if (error) throw error;
}

export async function getActiveLocationShares() {
  const { data, error } = await supabase.from("location_shares").select("*").gt("expires_at", new Date().toISOString()).order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDmMessages(userId, friendId) {
  const chatId = [userId, friendId].sort().join("_");
  const { data, error } = await supabase.from("messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true });
  if (error) throw error;
  return { chatId, messages: data || [] };
}

export async function sendDmMessage(userId, friendId, content, type = "text") {
  const chatId = [userId, friendId].sort().join("_");
  const { error } = await supabase.from("messages").insert({ chat_id: chatId, sender_id: userId, receiver_id: friendId, content, type, is_read: false });
  if (error) throw error;
}


export async function blockUser(targetId) {
  const { error } = await supabase.rpc("block_user", { target: targetId });
  if (error) throw error;
}

export async function reportUser(userId, targetId, reason) {
  const { error } = await supabase.from("flags").insert({
    reporter_id: userId,
    reported_user_id: targetId,
    reason: reason.slice(0, 500),
    resolved: false,
  });
  if (error) throw error;
}

export async function deleteMyAccount() {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
}
