import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  Bell,
  Image as ImageIcon,
  X,
  Search,
  UserPlus,
  Check,
  Flag,
  ShieldCheck,
  Camera,
  Palette,
  Settings,
  Smile,
  Pencil,
  Megaphone,
  Paperclip,
  File as FileIcon,
  Download,
  Users,
} from "lucide-react";
import {
  registerServiceWorker,
  ensureNotificationPermission,
  subscribeToPush,
} from "./push";
import Admin from "./Admin";
import "./styles.css";

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY;

// Usernames allowed to use fast account-switching. Only these accounts get
// remembered on the device — everyone else's password is never stored.
// Add your own usernames here (e.g. "admin", "jake").
const SWITCHER_USERS = ["admin"];

// Reject keyboard-mash / junk names while allowing real ones.
const NAME_BLOCKLIST = [
  "test", "testing", "asdf", "asdfgh", "qwer", "qwerty", "zxcv", "wasd",
  "hjkl", "lkjh", "poiu", "mnbv", "abc", "abcd", "xyz", "blah", "name",
  "firstname", "lastname", "user", "admin", "null", "undefined",
];

// A single word is acceptable unless it's obvious junk. We intentionally do
// NOT judge "real-ness" by vowel ratios etc., because real names (Yeo, Smith,
// Ng, Bo…) break those rules. We only block the blocklist and triple-letter
// mash like "aaargh".
function isPronounceablePart(w) {
  if (w.length <= 1) return true; // initials like "J" are fine
  if (NAME_BLOCKLIST.includes(w)) return false;
  if (/(.)\1\1/.test(w)) return false; // no 3+ identical in a row (aaaa)
  return true;
}

function looksLikeName(s) {
  const v = (s || "").trim().toLowerCase();
  if (v.length < 2 || v.length > 30) return false;
  if (!/^[a-zà-ÿ' -]+$/i.test(v)) return false; // letters, spaces, ' and - only
  // validate each word so "Anne-Marie" / "Mary Jane" / "de la Cruz" pass
  const parts = v.split(/[ '-]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(isPronounceablePart);
}

// Whole years between a YYYY-MM-DD birthday and today.
function ageFromBirthday(birthday) {
  if (!birthday) return null;
  const bd = new Date(birthday);
  if (isNaN(bd.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
  return age;
}

const THEMES = [
  { id: "dusk", name: "Warm Dusk", color: "#FF6B5B" },
  { id: "midnight", name: "Midnight", color: "#6C7CFF" },
  { id: "ocean", name: "Ocean", color: "#2DD4BF" },
  { id: "forest", name: "Forest", color: "#4ADE80" },
  { id: "grape", name: "Grape", color: "#C084FC" },
  { id: "rose", name: "Rose", color: "#FB7185" },
  { id: "daylight", name: "Daylight", color: "#F59E0B" },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({
    firstName: "",
    lastName: "",
    email: "",
    birthday: "",
    username: "",
    password: "",
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [view, setView] = useState("chat"); // chat | admin

  // friends + requests
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingIds, setOutgoingIds] = useState(new Set());

  // my own strikes (each user sees only their own)
  const [myStrikes, setMyStrikes] = useState([]);

  // message reactions
  const [reactions, setReactions] = useState([]);
  const [reactPickerMsg, setReactPickerMsg] = useState(null);

  // batch 1: typing, edit, reply, emoji, search
  const [theirTyping, setTheirTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [msgSearch, setMsgSearch] = useState("");

  // avatar upload
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // theme
  const [theme, setTheme] = useState(
    () => localStorage.getItem("wavo-theme") || "dusk"
  );
  const [themeOpen, setThemeOpen] = useState(false);

  // saved accounts for quick switching (stored on this device only)
  const [accounts, setAccounts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("wavo-accounts") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dusk") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("wavo-theme", theme);
  }, [theme]);

  // settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState("");
  // batch 2: status + nicknames
  const [statusDraft, setStatusDraft] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [nicknames, setNicknames] = useState({});
  // batch 3: latest announcement banner
  const [announcement, setAnnouncement] = useState(null);
  // batch 4: file upload
  const [uploadingFile, setUploadingFile] = useState(false);
  const [desktopNotifs, setDesktopNotifs] = useState(
    () => localStorage.getItem("wavo-desktop-notifs") === "on"
  );

  // add-friend search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [isFocused, setIsFocused] = useState(true);

  // batch 5: group chats
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupMembers, setGroupMembers] = useState({}); // userId -> profile
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]); // friend ids
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupTyping, setGroupTyping] = useState(null); // name of who's typing

  // notifications dropdown
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifTab, setNotifTab] = useState("notifs"); // notifs | requests

  // giphy
  const [showGiphy, setShowGiphy] = useState(false);
  const [giphySearch, setGiphySearch] = useState("");
  const [giphyResults, setGiphyResults] = useState([]);
  const [giphyLoading, setGiphyLoading] = useState(false);

  const bottomRef = useRef(null);
  const selectedUserRef = useRef(null);
  const isFocusedRef = useRef(true);
  const avatarInputRef = useRef(null);
  const longPressRef = useRef(null);
  const chatChannelRef = useRef(null);
  const typingTimerRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const chatFileInputRef = useRef(null);
  const groupChannelRef = useRef(null);

  const currentUser = session?.user;

  const chatId = useMemo(() => {
    if (!currentUser || !selectedUser) return null;
    return [currentUser.id, selectedUser.id].sort().join("_");
  }, [currentUser, selectedUser]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const bellCount = unreadCount + incomingRequests.length;

  const unreadByUser = useMemo(() => {
    const map = {};
    notifications.forEach((n) => {
      if (!n.is_read && n.sender_id) {
        map[n.sender_id] = (map[n.sender_id] || 0) + 1;
      }
    });
    return map;
  }, [notifications]);

  // --- UTILITIES ---
  const initial = (name) => (name?.trim()?.[0] || "?").toUpperCase();

  const markAsRead = async (msgId) => {
    await supabase
      .from("messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", msgId);
  };

  const triggerNotification = (msg, fromName) => {
    if (localStorage.getItem("wavo-desktop-notifs") === "off") return;
    if (Notification.permission === "granted") {
      new Notification(`Wavo: ${fromName || "New Message"}`, {
        body: msg.content,
        icon: "/favicon.svg",
      });
    }
  };

  const clearNotifsFromSender = async (senderId) => {
    const toClear = notifications.filter(
      (n) => n.sender_id === senderId && !n.is_read
    );
    if (toClear.length === 0) return;
    setNotifications((prev) =>
      prev.map((n) => (n.sender_id === senderId ? { ...n, is_read: true } : n))
    );
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("sender_id", senderId)
      .eq("user_id", currentUser.id)
      .eq("is_read", false);
  };

  const markAllNotifsRead = async () => {
    if (unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", currentUser.id)
      .eq("is_read", false);
  };

  // --- LIFECYCLE & FOCUS ---
  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      registerServiceWorker();
    }
    init();

    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadProfile();
    loadFriends();
    loadRequests();
    loadNotifications();
    loadMyStrikes();
    loadNicknames();
    loadAnnouncement();
    loadGroups();
  }, [currentUser]);

  // --- ANNOUNCEMENTS banner ---
  async function loadAnnouncement() {
    const { data } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = data?.[0];
    if (latest && localStorage.getItem("wavo-seen-announce") !== latest.id) {
      setAnnouncement(latest);
    } else {
      setAnnouncement(null);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel("announce")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcements" },
        (payload) => setAnnouncement(payload.new)
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser]);

  function dismissAnnouncement() {
    if (announcement) localStorage.setItem("wavo-seen-announce", announcement.id);
    setAnnouncement(null);
  }

  // --- LAST ONLINE heartbeat ---
  useEffect(() => {
    if (!currentUser) return;
    const ping = () => supabase.rpc("touch_last_active");
    ping();
    const interval = setInterval(ping, 60000);
    window.addEventListener("focus", ping);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", ping);
    };
  }, [currentUser]);

  // --- PUSH SUBSCRIPTION (post-login) ---
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      const granted = await ensureNotificationPermission();
      if (cancelled || !granted) return;
      await subscribeToPush(currentUser.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // --- NOTIFICATIONS REALTIME ---
  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel(`notifications:${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        (payload) => {
          const notif = payload.new;
          setNotifications((prev) => [notif, ...prev]);

          const openChatId = selectedUserRef.current
            ? [currentUser.id, selectedUserRef.current.id].sort().join("_")
            : null;
          const chatIsActive =
            isFocusedRef.current && openChatId === notif.chat_id;

          if (!chatIsActive) {
            triggerNotification({ content: notif.body }, notif.title);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // --- FRIEND REQUESTS REALTIME ---
  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel(`friends:${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `receiver_id=eq.${currentUser.id}`,
        },
        () => {
          loadRequests();
          loadFriends();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `sender_id=eq.${currentUser.id}`,
        },
        () => {
          loadRequests();
          loadFriends();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // --- CHAT MESSAGES REALTIME ---
  useEffect(() => {
    if (!chatId) return;
    loadMessages();
    loadReactions();

    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newMsg = payload.new;
          setMessages((prev) => [...prev.filter((m) => m.id !== newMsg.id), newMsg]);

          if (newMsg.receiver_id === currentUser.id && isFocused) {
            markAsRead(newMsg.id);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.new.id ? payload.new : m))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reactions",
          filter: `chat_id=eq.${chatId}`,
        },
        () => loadReactions()
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.userId && payload.userId !== currentUser.id) {
          setTheirTyping(true);
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setTheirTyping(false), 2500);
        }
      })
      .subscribe();

    chatChannelRef.current = channel;
    setTheirTyping(false);

    return () => {
      chatChannelRef.current = null;
      clearTimeout(typingTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [chatId, isFocused]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- GROUP CHAT REALTIME ---
  useEffect(() => {
    if (!selectedGroup) return;
    const gid = selectedGroup.id;
    loadGroupMessages(gid);
    loadGroupMembers(gid);
    setGroupTyping(null);

    const channel = supabase
      .channel(`group:${gid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${gid}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setGroupMessages((prev) => [
              ...prev.filter((m) => m.id !== payload.new.id),
              payload.new,
            ]);
          } else if (payload.eventType === "UPDATE") {
            setGroupMessages((prev) =>
              prev.map((m) => (m.id === payload.new.id ? payload.new : m))
            );
          }
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.userId && payload.userId !== currentUser.id) {
          setGroupTyping(payload.name || "Someone");
          clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setGroupTyping(null), 2500);
        }
      })
      .subscribe();

    groupChannelRef.current = channel;

    return () => {
      groupChannelRef.current = null;
      clearTimeout(typingTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [selectedGroup]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groupMessages]);

  // --- DATA FETCHING ---
  async function loadProfile() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .single();
    if (data) setProfile(data);
  }

  async function loadMyStrikes() {
    const { data } = await supabase
      .from("strikes")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (data) setMyStrikes(data);
  }

  async function loadFriends() {
    const { data: rows } = await supabase
      .from("friend_requests")
      .select("sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);
    if (!rows || rows.length === 0) {
      setFriends([]);
      return;
    }
    const otherIds = rows.map((r) =>
      r.sender_id === currentUser.id ? r.receiver_id : r.sender_id
    );
    const { data: profs } = await supabase
      .from("profiles")
      .select("*")
      .in("id", otherIds);
    setFriends(profs || []);
  }

  async function loadRequests() {
    const { data: incoming } = await supabase
      .from("friend_requests")
      .select("id, sender_id, created_at")
      .eq("receiver_id", currentUser.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const { data: outgoing } = await supabase
      .from("friend_requests")
      .select("receiver_id")
      .eq("sender_id", currentUser.id)
      .eq("status", "pending");

    let withNames = [];
    if (incoming && incoming.length) {
      const ids = incoming.map((r) => r.sender_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);
      const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));
      withNames = incoming.map((r) => ({
        ...r,
        username: byId[r.sender_id]?.username || "Unknown",
      }));
    }
    setIncomingRequests(withNames);
    setOutgoingIds(new Set((outgoing || []).map((r) => r.receiver_id)));
  }

  async function loadNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setNotifications(data);
  }

  async function loadMessages() {
    setLoadingChat(true);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    if (data) {
      setMessages(data);
      data.forEach((m) => {
        if (m.receiver_id === currentUser.id && !m.is_read) markAsRead(m.id);
      });
    }
    setLoadingChat(false);
  }

  // --- REACTIONS ---
  async function loadReactions() {
    if (!chatId) return;
    const { data } = await supabase.from("reactions").select("*").eq("chat_id", chatId);
    if (data) setReactions(data);
  }

  function reactionsFor(msgId) {
    const grouped = {};
    reactions
      .filter((r) => r.message_id === msgId)
      .forEach((r) => {
        if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false };
        grouped[r.emoji].count += 1;
        if (r.user_id === currentUser.id) grouped[r.emoji].mine = true;
      });
    return grouped;
  }

  async function addReaction(msg, emoji) {
    setReactPickerMsg(null);
    const existing = reactions.find(
      (r) => r.message_id === msg.id && r.user_id === currentUser.id && r.emoji === emoji
    );
    if (existing) {
      await supabase.from("reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("reactions").insert({
        message_id: msg.id,
        chat_id: chatId,
        user_id: currentUser.id,
        emoji,
      });
    }
    loadReactions();
  }

  function startPress(msg) {
    clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => setReactPickerMsg(msg.id), 450);
  }
  function endPress() {
    clearTimeout(longPressRef.current);
  }

  // --- AVATAR UPLOAD ---
  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${currentUser.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${pub.publicUrl}?t=${Date.now()}`;
      const { error: rpcErr } = await supabase.rpc("set_avatar", { url });
      if (rpcErr) throw rpcErr;
      await loadProfile();
      await loadFriends();
    } catch (err) {
      alert("Couldn't upload picture: " + err.message);
    }
    setUploadingAvatar(false);
    e.target.value = "";
  }

  // --- SETTINGS ---
  // --- ACCOUNT SWITCHER ---
  function rememberAccount(username, password) {
    // Only store credentials for accounts you've explicitly allowed.
    if (!SWITCHER_USERS.includes(username)) return;
    try {
      const list = JSON.parse(localStorage.getItem("wavo-accounts") || "[]");
      const next = list.filter((a) => a.username !== username);
      next.push({ username, password });
      localStorage.setItem("wavo-accounts", JSON.stringify(next));
      setAccounts(next);
    } catch {
      /* ignore */
    }
  }

  function removeAccount(username) {
    const next = accounts.filter((a) => a.username !== username);
    localStorage.setItem("wavo-accounts", JSON.stringify(next));
    setAccounts(next);
  }

  async function switchTo(account) {
    if (account.username === profile?.username) return;
    try {
      await supabase.auth.signOut();
      const { error } = await supabase.auth.signInWithPassword({
        email: `${account.username}@wavo.app`,
        password: account.password,
      });
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      alert(`Couldn't switch to ${account.username}: ${err.message}`);
    }
  }

  async function addAccount() {
    setShowSettings(false);
    await supabase.auth.signOut();
  }

  function openSettings() {
    setUsernameDraft(profile?.username || "");
    setStatusDraft(profile?.status || "");
    setNameMsg("");
    setShowSettings(true);
  }

  async function saveUsername() {
    const clean = usernameDraft.trim();
    if (!clean || clean === profile?.username) return;
    setSavingName(true);
    setNameMsg("");
    const { error } = await supabase.rpc("set_username", { new_name: clean });
    if (error) {
      setNameMsg(error.message);
    } else {
      setNameMsg("Saved!");
      await loadProfile();
      await loadFriends();
    }
    setSavingName(false);
  }

  async function saveStatus() {
    setSavingStatus(true);
    const { error } = await supabase.rpc("set_status", {
      new_status: statusDraft.trim(),
    });
    if (!error) {
      await loadProfile();
      await loadFriends();
    } else {
      alert(error.message);
    }
    setSavingStatus(false);
  }

  // --- NICKNAMES (private, only you see them) ---
  async function loadNicknames() {
    const { data } = await supabase
      .from("nicknames")
      .select("target_id, nickname")
      .eq("owner_id", currentUser.id);
    if (data) {
      const map = {};
      data.forEach((n) => (map[n.target_id] = n.nickname));
      setNicknames(map);
    }
  }

  async function setNickname(targetUser) {
    const current = nicknames[targetUser.id] || "";
    const input = window.prompt(
      `Nickname for ${targetUser.username} (only you see this). Leave blank to clear:`,
      current
    );
    if (input === null) return; // cancelled
    const clean = input.trim();
    if (clean) {
      await supabase.from("nicknames").upsert(
        {
          owner_id: currentUser.id,
          target_id: targetUser.id,
          nickname: clean,
        },
        { onConflict: "owner_id,target_id" }
      );
    } else {
      await supabase
        .from("nicknames")
        .delete()
        .eq("owner_id", currentUser.id)
        .eq("target_id", targetUser.id);
    }
    loadNicknames();
  }

  // nickname if you set one, otherwise their real username
  function displayName(user) {
    if (!user) return "";
    return nicknames[user.id] || user.username;
  }

  async function removeAvatar() {
    const { error } = await supabase.rpc("set_avatar", { url: null });
    if (!error) {
      await loadProfile();
      await loadFriends();
    }
  }

  function toggleDesktopNotifs() {
    if (!desktopNotifs) {
      if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission().then((perm) => {
          const on = perm === "granted";
          setDesktopNotifs(on);
          localStorage.setItem("wavo-desktop-notifs", on ? "on" : "off");
        });
        return;
      }
      setDesktopNotifs(true);
      localStorage.setItem("wavo-desktop-notifs", "on");
    } else {
      setDesktopNotifs(false);
      localStorage.setItem("wavo-desktop-notifs", "off");
    }
  }

  // --- FRIEND ACTIONS ---
  // search live as you type (debounced) — no need to press Enter
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => runSearch(), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function runSearch(e) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${q}%`)
      .neq("id", currentUser.id)
      .limit(10);
    const friendIds = new Set(friends.map((f) => f.id));
    setSearchResults(
      (data || []).map((u) => ({ ...u, isFriend: friendIds.has(u.id) }))
    );
    setSearching(false);
  }

  async function sendRequest(userId) {
    const existingIncoming = incomingRequests.find((r) => r.sender_id === userId);
    if (existingIncoming) {
      acceptRequest(existingIncoming.id);
      return;
    }
    const { error } = await supabase.from("friend_requests").insert({
      sender_id: currentUser.id,
      receiver_id: userId,
      status: "pending",
    });
    if (error) {
      alert(error.message);
      return;
    }
    setOutgoingIds((prev) => new Set(prev).add(userId));
  }

  async function acceptRequest(reqId) {
    await supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", reqId);
    await loadRequests();
    await loadFriends();
  }

  async function declineRequest(reqId) {
    await supabase.from("friend_requests").delete().eq("id", reqId);
    await loadRequests();
  }

  // --- REPORTING ---
  async function reportMessage(msg) {
    const reason = window.prompt("Why are you reporting this message? (optional)");
    if (reason === null) return; // cancelled
    const { error } = await supabase.from("flags").insert({
      message_id: msg.id,
      reporter_id: currentUser.id,
      reason: reason.trim() || null,
    });
    if (error) alert(error.message);
    else alert("Reported — an admin will review it.");
  }

  async function reportUser(user) {
    const reason = window.prompt(`Report ${user.username}? Add a reason (optional):`);
    if (reason === null) return; // cancelled
    const { error } = await supabase.from("flags").insert({
      reported_user_id: user.id,
      reporter_id: currentUser.id,
      reason: reason.trim() || null,
    });
    if (error) alert(error.message);
    else alert(`Reported ${user.username} — an admin will review it.`);
  }

  // --- ACTIONS ---
  function openChat(user) {
    setSelectedGroup(null);
    setEditingMsg(null);
    setReplyingTo(null);
    setMessageText("");
    setSelectedUser(user);
    setShowGiphy(false);
    clearNotifsFromSender(user.id);
  }

  // --- GROUPS ---
  async function loadGroups() {
    // groups I'm a member of
    const { data: mem } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", currentUser.id);
    const ids = (mem || []).map((m) => m.group_id);
    if (ids.length === 0) {
      setGroups([]);
      return;
    }
    const { data } = await supabase
      .from("groups")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: true });
    if (data) setGroups(data);
  }

  async function loadGroupMessages(gid) {
    setLoadingChat(true);
    const { data } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", gid)
      .order("created_at", { ascending: true });
    if (data) setGroupMessages(data);
    setLoadingChat(false);
  }

  async function loadGroupMembers(gid) {
    const { data } = await supabase
      .from("group_members")
      .select("user_id, profiles(id, username, avatar_url)")
      .eq("group_id", gid);
    if (data) {
      const map = {};
      data.forEach((row) => {
        if (row.profiles) map[row.profiles.id] = row.profiles;
      });
      setGroupMembers(map);
    }
  }

  function openGroup(group) {
    setSelectedUser(null);
    setEditingMsg(null);
    setReplyingTo(null);
    setMessageText("");
    setShowGiphy(false);
    setShowEmoji(false);
    setGroupMessages([]);
    setSelectedGroup(group);
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name || newGroupMembers.length === 0) {
      alert("Give your group a name and pick at least one friend.");
      return;
    }
    setCreatingGroup(true);
    try {
      const { data: group, error } = await supabase
        .from("groups")
        .insert({ name, created_by: currentUser.id })
        .select()
        .single();
      if (error) throw error;
      const rows = [currentUser.id, ...newGroupMembers].map((uid) => ({
        group_id: group.id,
        user_id: uid,
      }));
      const { error: memErr } = await supabase
        .from("group_members")
        .insert(rows);
      if (memErr) throw memErr;
      setShowNewGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
      await loadGroups();
      openGroup(group);
    } catch (err) {
      alert("Couldn't create group: " + err.message);
    }
    setCreatingGroup(false);
  }

  async function insertGroupMessage(content, type, fileName = null) {
    if (!selectedGroup) return;
    const { error } = await supabase.from("group_messages").insert({
      group_id: selectedGroup.id,
      sender_id: currentUser.id,
      content,
      type,
      file_name: fileName,
      reply_to: replyingTo?.id || null,
    });
    if (error) alert(error.message);
    setReplyingTo(null);
  }

  async function sendGroupMessage(e) {
    e.preventDefault();
    const text = messageText.trim();
    if (!text) return;

    if (editingMsg) {
      const target = editingMsg;
      setMessageText("");
      setEditingMsg(null);
      setGroupMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? { ...m, content: text, edited_at: new Date().toISOString() }
            : m
        )
      );
      const { error } = await supabase
        .from("group_messages")
        .update({ content: text, edited_at: new Date().toISOString() })
        .eq("id", target.id);
      if (error) alert(error.message);
      return;
    }

    setMessageText("");
    setShowEmoji(false);
    await insertGroupMessage(text, "text");
  }

  function notifyGroupTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1400) return;
    lastTypingSentRef.current = now;
    groupChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUser.id, name: profile?.username },
    });
  }

  async function leaveGroup() {
    if (!selectedGroup) return;
    if (!window.confirm(`Leave "${selectedGroup.name}"?`)) return;
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", selectedGroup.id)
      .eq("user_id", currentUser.id);
    setSelectedGroup(null);
    loadGroups();
  }

  async function insertMessage(content, type, fileName = null) {
    if (!chatId || !selectedUser) return;
    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: currentUser.id,
      receiver_id: selectedUser.id,
      content,
      type,
      is_read: false,
      reply_to: replyingTo?.id || null,
      file_name: fileName,
    });
    if (error) alert(error.message);
    setReplyingTo(null);
  }

  async function uploadChatFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("That file is too big (max 10 MB).");
      e.target.value = "";
      return;
    }
    setUploadingFile(true);
    try {
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const folder = selectedGroup ? `group_${selectedGroup.id}` : chatId;
      const path = `${folder}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("chat-files")
        .upload(path, file);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage
        .from("chat-files")
        .getPublicUrl(path);
      const isImg = file.type.startsWith("image/");
      if (selectedGroup) {
        await insertGroupMessage(
          pub.publicUrl,
          isImg ? "image" : "file",
          isImg ? null : file.name
        );
      } else {
        await insertMessage(
          pub.publicUrl,
          isImg ? "image" : "file",
          isImg ? null : file.name
        );
      }
    } catch (err) {
      alert("Couldn't send file: " + err.message);
    }
    setUploadingFile(false);
    e.target.value = "";
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = messageText.trim();
    if (!text) return;

    // editing an existing message?
    if (editingMsg) {
      setMessageText("");
      const target = editingMsg;
      setEditingMsg(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? { ...m, content: text, edited_at: new Date().toISOString() }
            : m
        )
      );
      const { error } = await supabase
        .from("messages")
        .update({ content: text, edited_at: new Date().toISOString() })
        .eq("id", target.id);
      if (error) alert(error.message);
      return;
    }

    setMessageText("");
    setShowEmoji(false);
    await insertMessage(text, "text");
  }

  function startEdit(msg) {
    setReactPickerMsg(null);
    setReplyingTo(null);
    setEditingMsg(msg);
    setMessageText(msg.content);
  }
  function cancelEdit() {
    setEditingMsg(null);
    setMessageText("");
  }
  function startReply(msg) {
    setReactPickerMsg(null);
    setEditingMsg(null);
    setReplyingTo(msg);
  }
  async function deleteMessage(msg) {
    setReactPickerMsg(null);
    if (!window.confirm("Unsend this message?")) return;
    const stamp = new Date().toISOString();
    if (selectedGroup) {
      setGroupMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, deleted_at: stamp } : m))
      );
      const { error } = await supabase
        .from("group_messages")
        .update({ deleted_at: stamp })
        .eq("id", msg.id);
      if (error) alert(error.message);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, deleted_at: stamp } : m))
    );
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: stamp })
      .eq("id", msg.id);
    if (error) alert(error.message);
  }

  // typing broadcast (throttled to once per ~1.4s)
  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1400) return;
    lastTypingSentRef.current = now;
    chatChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUser.id },
    });
  }

  function insertEmoji(em) {
    setMessageText((t) => t + em);
  }

  // presence label from a last_active timestamp
  function presence(ts) {
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 70000) return "online";
    return `last seen ${fmtRelative(ts)}`;
  }

  async function sendGif(gifUrl) {
    setShowGiphy(false);
    setGiphySearch("");
    setGiphyResults([]);
    await insertMessage(gifUrl, "image");
  }

  // --- GIPHY ---
  async function searchGiphy(e) {
    e?.preventDefault();
    const q = giphySearch.trim();
    if (!GIPHY_API_KEY) {
      alert("GIPHY API key is missing. Add VITE_GIPHY_API_KEY in Vercel.");
      return;
    }
    setGiphyLoading(true);
    try {
      const endpoint = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(
            q
          )}&limit=18&rating=pg`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=18&rating=pg`;
      const res = await fetch(endpoint);
      const json = await res.json();
      setGiphyResults(json.data || []);
    } catch (err) {
      alert("Couldn't load GIFs: " + err.message);
    }
    setGiphyLoading(false);
  }

  function toggleGiphy() {
    const next = !showGiphy;
    setShowGiphy(next);
    if (next && giphyResults.length === 0) {
      searchGiphy();
    }
  }

  async function handleAuth(e) {
    e.preventDefault();
    const email = `${auth.username.trim()}@wavo.app`;

    // extra validation for sign-up
    if (mode === "signup") {
      if (
        !auth.firstName.trim() ||
        !auth.lastName.trim() ||
        !auth.email.trim() ||
        !auth.birthday ||
        !auth.username.trim() ||
        !auth.password
      ) {
        alert("Please fill in every field.");
        return;
      }
      if (!looksLikeName(auth.firstName)) {
        alert("Please enter a real first name.");
        return;
      }
      // Last name accepts anything (real surnames are too varied to validate).
      if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(auth.email.trim())) {
        alert("Please enter a valid email address (like name@example.com).");
        return;
      }
      const bd = new Date(auth.birthday);
      const age = ageFromBirthday(auth.birthday);
      if (isNaN(bd.getTime()) || bd > new Date()) {
        alert("Please enter a valid birthday.");
        return;
      }
      if (age === null || age < 1 || age > 120) {
        alert("Please enter a valid birthday.");
        return;
      }
    }

    setAuthLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: auth.password,
        });
        if (error) throw error;
        rememberAccount(auth.username.trim(), auth.password);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: auth.password,
        });
        if (error) throw error;
        const { error: profileErr } = await supabase.from("profiles").insert({
          id: data.user.id,
          username: auth.username.trim(),
          first_name: auth.firstName.trim(),
          last_name: auth.lastName.trim(),
          email: auth.email.trim(),
          birthday: auth.birthday,
          age: ageFromBirthday(auth.birthday),
        });
        if (profileErr) throw profileErr;
        rememberAccount(auth.username.trim(), auth.password);
        setMode("login");
      }
    } catch (err) {
      alert(err.message);
    }
    setAuthLoading(false);
  }

  // --- TIME FORMATTING ---
  const fmtTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtRelative = (ts) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // avatar = picture if they have one, otherwise their initial
  function Avatar({ url, name, size }) {
    return (
      <div className={`avatar ${size === "sm" ? "sm" : ""}`}>
        {url ? <img className="avatar-img" src={url} alt="" /> : initial(name)}
      </div>
    );
  }

  // --- AUTH SCREEN ---
  if (!session) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="logo-mark">W</div>
          <h1>Wavo</h1>
          <p className="auth-tagline">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </p>
          <form onSubmit={handleAuth} className="auth-form">
            {mode === "signup" && (
              <>
                <div className="auth-row">
                  <input
                    type="text"
                    placeholder="First name"
                    value={auth.firstName}
                    onChange={(e) =>
                      setAuth({ ...auth, firstName: e.target.value })
                    }
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={auth.lastName}
                    onChange={(e) =>
                      setAuth({ ...auth, lastName: e.target.value })
                    }
                  />
                </div>
                <input
                  type="email"
                  placeholder="Email"
                  value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })}
                />
                <label className="auth-field-label">Birthday</label>
                <input
                  type="date"
                  className="auth-date"
                  value={auth.birthday}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setAuth({ ...auth, birthday: e.target.value })}
                />
                <div className="auth-divider">
                  <span>Choose your login</span>
                </div>
              </>
            )}
            <input
              type="text"
              placeholder="Username"
              value={auth.username}
              onChange={(e) => setAuth({ ...auth, username: e.target.value })}
            />
            <input
              type="password"
              placeholder="Password"
              value={auth.password}
              onChange={(e) => setAuth({ ...auth, password: e.target.value })}
            />
            <button disabled={authLoading}>
              {authLoading
                ? "Please wait…"
                : mode === "login"
                ? "Login"
                : "Create account"}
            </button>
          </form>
          <button
            className="link-btn"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "New here? Create an account" : "Already have an account? Login"}
          </button>
        </div>
      </main>
    );
  }

  // --- BANNED SCREEN ---
  const bannedUntil = profile?.banned_until ? new Date(profile.banned_until) : null;
  const isBanned = bannedUntil && bannedUntil > new Date();
  if (isBanned) {
    const permanent = bannedUntil.getFullYear() > 2900;
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="logo-mark" style={{ background: "var(--line)" }}>!</div>
          <h1>Account suspended</h1>
          <p style={{ color: "var(--text-dim)", textAlign: "center", margin: "8px 0 20px" }}>
            {permanent
              ? "Your account has been permanently banned from Wavo."
              : `Your account is banned until ${bannedUntil.toLocaleString()}.`}
          </p>
          <button className="link-btn" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </main>
    );
  }

  // --- ADMIN VIEW ---
  if (view === "admin" && profile?.is_admin) {
    return <Admin me={profile} onBack={() => setView("chat")} />;
  }

  // --- MAIN APP ---
  return (
    <main className="app-shell">
      {announcement && (
        <div className="announce-banner">
          <Megaphone size={16} />
          <span className="announce-banner-text">{announcement.body}</span>
          <button onClick={dismissAnnouncement} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand-row">
          <h2>Wavo</h2>
          <div className="brand-actions">
            <div className="notif-wrap">
              <button
                className="icon-btn"
                onClick={() => setShowNotifs((s) => !s)}
                aria-label="Notifications"
                title="Notifications & friend requests"
              >
                <Bell size={18} />
                {bellCount > 0 && (
                  <span className="notif-dot">{bellCount > 9 ? "9+" : bellCount}</span>
                )}
              </button>

              {showNotifs && (
                <div className="notif-panel">
                  <div className="notif-tabs">
                    <button
                      className={notifTab === "notifs" ? "active" : ""}
                      onClick={() => setNotifTab("notifs")}
                    >
                      Notifications
                      {unreadCount > 0 && <span className="tab-count">{unreadCount}</span>}
                    </button>
                    <button
                      className={notifTab === "requests" ? "active" : ""}
                      onClick={() => setNotifTab("requests")}
                    >
                      Requests
                      {incomingRequests.length > 0 && (
                        <span className="tab-count">{incomingRequests.length}</span>
                      )}
                    </button>
                  </div>

                  {notifTab === "notifs" ? (
                    <>
                      {unreadCount > 0 && (
                        <div className="notif-panel-head">
                          <button className="link-btn-sm" onClick={markAllNotifsRead}>
                            Mark all read
                          </button>
                        </div>
                      )}
                      <div className="notif-list">
                        {notifications.length === 0 && (
                          <div className="notif-empty">Nothing yet</div>
                        )}
                        {notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`notif-item ${n.is_read ? "" : "unread"}`}
                          >
                            <div className="notif-item-top">
                              <strong>{n.title}</strong>
                              <span>{fmtRelative(n.created_at)}</span>
                            </div>
                            {n.body && <p>{n.body}</p>}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="notif-list">
                      {incomingRequests.length === 0 && (
                        <div className="notif-empty">No friend requests</div>
                      )}
                      {incomingRequests.map((r) => (
                        <div key={r.id} className="req-item">
                          <div className="avatar sm">{initial(r.username)}</div>
                          <div className="req-name">
                            <strong>{r.username}</strong>
                            <span>{fmtRelative(r.created_at)}</span>
                          </div>
                          <div className="req-actions">
                            <button
                              className="req-accept"
                              onClick={() => acceptRequest(r.id)}
                              aria-label="Accept"
                              title="Accept friend request"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              className="req-decline"
                              onClick={() => declineRequest(r.id)}
                              aria-label="Decline"
                              title="Decline friend request"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {profile?.is_admin && (
              <button
                className="icon-btn"
                onClick={() => setView("admin")}
                aria-label="Admin dashboard"
                title="Admin dashboard"
              >
                <ShieldCheck size={18} />
              </button>
            )}
            <button
              className="ghost-btn"
              onClick={() => supabase.auth.signOut()}
              title="Sign out of Wavo"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Your own profile → opens settings */}
        <button className="me-strip" onClick={openSettings} title="Profile & settings">
          <Avatar url={profile?.avatar_url} name={profile?.username} />
          <div className="me-name">
            <strong>{profile?.username}</strong>
            <span>Profile &amp; settings</span>
          </div>
          <Settings size={17} className="me-gear" />
        </button>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={uploadAvatar}
        />

        {showSettings && (
          <div className="settings-overlay" onClick={() => setShowSettings(false)}>
            <div className="settings-card" onClick={(e) => e.stopPropagation()}>
              <header className="settings-head">
                <h3>Settings</h3>
                <button
                  className="icon-btn"
                  onClick={() => setShowSettings(false)}
                  aria-label="Close settings"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="settings-body">
                {/* PROFILE */}
                <section className="settings-section">
                  <h4>Profile</h4>
                  <div className="settings-pfp-row">
                    <Avatar url={profile?.avatar_url} name={profile?.username} />
                    <div className="settings-pfp-actions">
                      <button
                        className="mini-btn"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploadingAvatar}
                      >
                        <Camera size={14} />
                        {uploadingAvatar ? "Uploading…" : "Change photo"}
                      </button>
                      {profile?.avatar_url && (
                        <button className="mini-btn ghost" onClick={removeAvatar}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <label className="settings-label">Username</label>
                  <div className="settings-name-row">
                    <input
                      className="settings-input"
                      value={usernameDraft}
                      onChange={(e) => setUsernameDraft(e.target.value)}
                      maxLength={20}
                    />
                    <button
                      className="mini-btn"
                      onClick={saveUsername}
                      disabled={
                        savingName || usernameDraft.trim() === profile?.username
                      }
                    >
                      {savingName ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {nameMsg && (
                    <p
                      className={`settings-msg ${
                        nameMsg === "Saved!" ? "ok" : "err"
                      }`}
                    >
                      {nameMsg}
                    </p>
                  )}

                  <label className="settings-label">Status</label>
                  <div className="settings-name-row">
                    <input
                      className="settings-input"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                      placeholder="e.g. 📚 studying"
                      maxLength={40}
                    />
                    <button
                      className="mini-btn"
                      onClick={saveStatus}
                      disabled={
                        savingStatus ||
                        statusDraft.trim() === (profile?.status || "")
                      }
                    >
                      {savingStatus ? "Saving…" : "Save"}
                    </button>
                  </div>
                </section>

                {/* APPEARANCE */}
                <section className="settings-section">
                  <h4>Appearance</h4>
                  <div className="theme-grid">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        className={`theme-option ${theme === t.id ? "active" : ""}`}
                        onClick={() => setTheme(t.id)}
                      >
                        <span
                          className="theme-swatch"
                          style={{ background: t.color }}
                        />
                        {t.name}
                      </button>
                    ))}
                  </div>
                </section>

                {/* NOTIFICATIONS */}
                <section className="settings-section">
                  <h4>Notifications</h4>
                  <button className="settings-toggle" onClick={toggleDesktopNotifs}>
                    <span>Desktop notifications</span>
                    <span className={`switch ${desktopNotifs ? "on" : ""}`}>
                      <span className="knob" />
                    </span>
                  </button>
                  <p className="settings-hint">
                    Popup alerts when a message arrives and Wavo isn't focused.
                  </p>
                </section>

                {/* SWITCH ACCOUNTS */}
                {SWITCHER_USERS.includes(profile?.username) && (
                  <section className="settings-section">
                    <h4>Accounts</h4>
                    <div className="acct-list">
                      {accounts.map((a) => {
                        const active = a.username === profile?.username;
                        return (
                          <div
                            key={a.username}
                            className={`acct-row ${active ? "active" : ""}`}
                          >
                            <Avatar
                              url={active ? profile?.avatar_url : undefined}
                              name={a.username}
                              size="sm"
                            />
                            <div className="acct-info">
                              <strong>{a.username}</strong>
                              <span>{active ? "Active now" : "Saved account"}</span>
                            </div>
                            {active ? (
                              <span
                                className="acct-active-dot"
                                title="Current account"
                              />
                            ) : (
                              <>
                                <button
                                  className="mini-btn"
                                  onClick={() => switchTo(a)}
                                >
                                  Switch
                                </button>
                                <button
                                  className="acct-remove"
                                  onClick={() => removeAccount(a.username)}
                                  title="Forget this account"
                                >
                                  <X size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button className="mini-btn ghost" onClick={addAccount}>
                      + Add another account
                    </button>
                    <p className="settings-hint">
                      Switching signs you straight into the saved account. Accounts
                      are stored on this device only.
                    </p>
                  </section>
                )}

                {/* ACCOUNT */}
                <section className="settings-section">
                  <h4>Account</h4>
                  <div className="settings-info">
                    <span>Username</span>
                    <strong>{profile?.username}</strong>
                  </div>
                  {profile?.created_at && (
                    <div className="settings-info">
                      <span>Member since</span>
                      <strong>
                        {new Date(profile.created_at).toLocaleDateString()}
                      </strong>
                    </div>
                  )}
                  <div className="settings-info">
                    <span>Role</span>
                    <strong>{profile?.is_admin ? "Admin" : "Member"}</strong>
                  </div>
                  <button
                    className="settings-signout"
                    onClick={() => supabase.auth.signOut()}
                  >
                    Sign out
                  </button>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Add-a-friend search */}
        <form className="add-search" onSubmit={runSearch}>
          <Search size={15} />
          <input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value.trim()) setSearchResults([]);
            }}
            placeholder="Find people by username…"
          />
        </form>

        {searchQuery.trim() && (
          <div className="search-results">
            {searching && <div className="search-status">Searching…</div>}
            {!searching && searchResults.length === 0 && (
              <div className="search-status">No users found</div>
            )}
            {searchResults.map((u) => {
              const pending = outgoingIds.has(u.id);
              const incoming = incomingRequests.some((r) => r.sender_id === u.id);
              return (
                <div key={u.id} className="search-row">
                  <Avatar url={u.avatar_url} name={u.username} size="sm" />
                  <strong>{u.username}</strong>
                  {u.isFriend ? (
                    <span className="tag-friend">Friends</span>
                  ) : pending ? (
                    <span className="tag-pending">Requested</span>
                  ) : (
                    <button
                      className="add-btn"
                      onClick={() => sendRequest(u.id)}
                      title={incoming ? "Accept their friend request" : "Send a friend request"}
                    >
                      <UserPlus size={14} />
                      {incoming ? "Accept" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {myStrikes.length > 0 && (
          <div className="strike-warning">
            ⚠️ You have {myStrikes.length} strike{myStrikes.length > 1 ? "s" : ""} (of 3).
            {myStrikes.length % 3 === 0
              ? " You've been temporarily banned."
              : " Reach 3 and you'll be banned for 3 days."}
            {myStrikes[0]?.reason && (
              <span className="strike-reason">Most recent: “{myStrikes[0].reason}”</span>
            )}
          </div>
        )}

        <div className="groups-head">
          <h4>Groups</h4>
          <button
            className="new-group-btn"
            onClick={() => setShowNewGroup(true)}
            title="New group"
          >
            <Users size={14} /> New
          </button>
        </div>
        {groups.length > 0 && (
          <div className="group-list">
            {groups.map((g) => (
              <button
                key={g.id}
                className={`user-row ${
                  selectedGroup?.id === g.id ? "active" : ""
                }`}
                onClick={() => openGroup(g)}
                title={`Open ${g.name}`}
              >
                <div className="group-avatar">
                  <Users size={16} />
                </div>
                <div className="user-row-text">
                  <strong>{g.name}</strong>
                  <span className="user-status">Group</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="friends-head">
          <h4>Friends</h4>
        </div>
        <div className="user-list">
          {friends.length === 0 && !searchQuery.trim() && (
            <div className="friends-empty">
              No friends yet — search a username above to send a request.
            </div>
          )}
          {friends.map((u) => (
            <button
              key={u.id}
              className={`user-row ${selectedUser?.id === u.id ? "active" : ""}`}
              onClick={() => openChat(u)}
              title={`Open chat with ${u.username}`}
            >
              <div
                className={`avatar-presence ${
                  presence(u.last_active) === "online" ? "online" : ""
                }`}
              >
                <Avatar url={u.avatar_url} name={u.username} />
              </div>
              <div className="user-row-text">
                <strong>{displayName(u)}</strong>
                {u.status && <span className="user-status">{u.status}</span>}
              </div>
              {unreadByUser[u.id] > 0 && (
                <span className="user-badge">{unreadByUser[u.id]}</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <section className="chat">
        {selectedUser ? (
          <>
            <header className="chat-header">
              <div className="chat-header-left">
                <div
                  className={`avatar-presence ${
                    presence(selectedUser.last_active) === "online" ? "online" : ""
                  }`}
                >
                  <Avatar
                    url={selectedUser.avatar_url}
                    name={selectedUser.username}
                    size="sm"
                  />
                </div>
                <div className="chat-header-name">
                  <h3>
                    {displayName(selectedUser)}
                    <button
                      className="nickname-btn"
                      onClick={() => setNickname(selectedUser)}
                      title="Set a private nickname"
                    >
                      <Pencil size={12} />
                    </button>
                  </h3>
                  <span className="presence-line">
                    {selectedUser.status
                      ? selectedUser.status
                      : presence(selectedUser.last_active) || ""}
                  </span>
                </div>
              </div>
              <div className="chat-header-right">
                <button
                  className={`icon-btn ${showSearch ? "active" : ""}`}
                  onClick={() => {
                    setShowSearch((s) => !s);
                    setMsgSearch("");
                  }}
                  title="Search this chat"
                >
                  <Search size={16} />
                </button>
                <button
                  className="report-user-btn"
                  onClick={() => reportUser(selectedUser)}
                  title={`Report ${selectedUser.username}`}
                >
                  <Flag size={14} /> Report
                </button>
              </div>
            </header>
            {showSearch && (
              <div className="chat-search">
                <Search size={14} />
                <input
                  value={msgSearch}
                  onChange={(e) => setMsgSearch(e.target.value)}
                  placeholder="Search messages…"
                  autoFocus
                />
                {msgSearch && (
                  <button onClick={() => setMsgSearch("")} title="Clear">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            <div className="messages">
              {(msgSearch.trim()
                ? messages.filter(
                    (m) =>
                      !m.deleted_at &&
                      (m.content || "")
                        .toLowerCase()
                        .includes(msgSearch.trim().toLowerCase())
                  )
                : messages
              ).map((msg) => {
                const mine = msg.sender_id === currentUser.id;
                const isImage = msg.type === "image";
                const chips = reactionsFor(msg.id);
                const deleted = !!msg.deleted_at;
                const repliedTo = msg.reply_to
                  ? messages.find((m) => m.id === msg.reply_to)
                  : null;
                return (
                  <div
                    key={msg.id}
                    className={`bubble-wrap ${mine ? "mine" : "theirs"}`}
                  >
                    {repliedTo && (
                      <div className="reply-quote">
                        <span className="reply-quote-name">
                          {repliedTo.sender_id === currentUser.id
                            ? "You"
                            : displayName(selectedUser)}
                        </span>
                        <span className="reply-quote-text">
                          {repliedTo.deleted_at
                            ? "message removed"
                            : repliedTo.type === "image"
                            ? "📷 photo"
                            : repliedTo.type === "file"
                            ? `📄 ${repliedTo.file_name || "file"}`
                            : repliedTo.content}
                        </span>
                      </div>
                    )}
                    <div
                      className={`bubble ${
                        isImage && !deleted ? "bubble-image" : ""
                      } ${deleted ? "deleted" : ""}`}
                      onTouchStart={() => !deleted && startPress(msg)}
                      onTouchEnd={endPress}
                      onTouchMove={endPress}
                      onMouseDown={() => !deleted && startPress(msg)}
                      onMouseUp={endPress}
                      onMouseLeave={endPress}
                    >
                      {deleted ? (
                        <p className="msg-deleted">🚫 message removed</p>
                      ) : isImage ? (
                        <img
                          className="msg-image"
                          src={msg.content}
                          alt="image"
                          loading="lazy"
                        />
                      ) : msg.type === "file" ? (
                        <a
                          className="file-chip"
                          href={msg.content}
                          target="_blank"
                          rel="noreferrer"
                          download={msg.file_name || true}
                        >
                          <FileIcon size={20} />
                          <span className="file-chip-name">
                            {msg.file_name || "file"}
                          </span>
                          <Download size={15} />
                        </a>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      {!deleted && (
                        <div className="msg-footer">
                          <span>
                            {fmtTime(msg.created_at)}
                            {msg.edited_at ? " · edited" : ""}
                          </span>
                          {mine ? (
                            <span
                              className={`receipt ${msg.is_read ? "read" : ""}`}
                            >
                              {msg.is_read
                                ? msg.read_at
                                  ? `Read ${fmtTime(msg.read_at)}`
                                  : "✓✓"
                                : "✓"}
                            </span>
                          ) : (
                            <button
                              className="report-btn"
                              onClick={() => reportMessage(msg)}
                              title="Report message"
                            >
                              <Flag size={12} />
                            </button>
                          )}
                        </div>
                      )}

                      {reactPickerMsg === msg.id && !deleted && (
                        <div className="msg-menu">
                          <div className="msg-menu-emojis">
                            {["👍", "❤️", "😂", "😮", "😢", "🔥"].map((em) => (
                              <button key={em} onClick={() => addReaction(msg, em)}>
                                {em}
                              </button>
                            ))}
                          </div>
                          <div className="msg-menu-actions">
                            <button onClick={() => startReply(msg)}>↩ Reply</button>
                            {mine && msg.type === "text" && (
                              <button onClick={() => startEdit(msg)}>✏️ Edit</button>
                            )}
                            {mine && (
                              <button
                                className="danger"
                                onClick={() => deleteMessage(msg)}
                              >
                                🗑️ Unsend
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {!deleted && Object.keys(chips).length > 0 && (
                      <div className="react-chips">
                        {Object.entries(chips).map(([em, info]) => (
                          <button
                            key={em}
                            className={`react-chip ${info.mine ? "mine" : ""}`}
                            onClick={() => addReaction(msg, em)}
                          >
                            {em} {info.count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {theirTyping && !msgSearch.trim() && (
                <div className="bubble-wrap theirs">
                  <div className="bubble typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
              {reactPickerMsg && (
                <div
                  className="react-overlay"
                  onClick={() => setReactPickerMsg(null)}
                />
              )}
            </div>

            {showGiphy && (
              <div className="giphy-panel">
                <form className="giphy-search" onSubmit={searchGiphy}>
                  <Search size={15} />
                  <input
                    value={giphySearch}
                    onChange={(e) => setGiphySearch(e.target.value)}
                    placeholder="Search GIFs…"
                    autoFocus
                  />
                  <button type="submit">Search</button>
                </form>
                <div className="giphy-grid">
                  {giphyLoading && <div className="giphy-status">Loading…</div>}
                  {!giphyLoading && giphyResults.length === 0 && (
                    <div className="giphy-status">No GIFs found</div>
                  )}
                  {!giphyLoading &&
                    giphyResults.map((g) => (
                      <button
                        key={g.id}
                        className="giphy-thumb"
                        onClick={() => sendGif(g.images.fixed_height.url)}
                      >
                        <img
                          src={g.images.fixed_width_small.url}
                          alt={g.title || "GIF"}
                          loading="lazy"
                          width={g.images.fixed_width_small.width}
                          height={g.images.fixed_width_small.height}
                        />
                      </button>
                    ))}
                </div>
              </div>
            )}

            {showEmoji && (
              <div className="emoji-panel">
                {[
                  "😀","😂","😍","🥰","😎","😅","🤔","😴",
                  "😭","😡","😱","🥳","🙏","🔥","🎉","✨",
                  "❤️","💀","💯","👀","👍","👎","🤝","🙌",
                ].map((em) => (
                  <button key={em} type="button" onClick={() => insertEmoji(em)}>
                    {em}
                  </button>
                ))}
              </div>
            )}

            {replyingTo && (
              <div className="reply-bar">
                <div className="reply-bar-text">
                  <strong>
                    Replying to{" "}
                    {replyingTo.sender_id === currentUser.id
                      ? "yourself"
                      : displayName(selectedUser)}
                  </strong>
                  <span>
                    {replyingTo.type === "image"
                      ? "📷 photo"
                      : replyingTo.type === "file"
                      ? `📄 ${replyingTo.file_name || "file"}`
                      : replyingTo.content}
                  </span>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)}>
                  <X size={16} />
                </button>
              </div>
            )}

            {editingMsg && (
              <div className="reply-bar editing">
                <div className="reply-bar-text">
                  <strong>Editing message</strong>
                  <span>Press Save to update it</span>
                </div>
                <button type="button" onClick={cancelEdit}>
                  <X size={16} />
                </button>
              </div>
            )}

            <form className="composer" onSubmit={sendMessage}>
              <button
                type="button"
                className={`composer-icon ${showGiphy ? "active" : ""}`}
                onClick={toggleGiphy}
                aria-label="Send a GIF"
                title={showGiphy ? "Close GIF picker" : "Send a GIF"}
              >
                {showGiphy ? <X size={18} /> : <ImageIcon size={18} />}
              </button>
              <button
                type="button"
                className={`composer-icon ${showEmoji ? "active" : ""}`}
                onClick={() => setShowEmoji((s) => !s)}
                aria-label="Emoji"
                title="Emoji"
              >
                <Smile size={18} />
              </button>
              <button
                type="button"
                className="composer-icon"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={uploadingFile}
                aria-label="Attach a file"
                title="Attach an image or file"
              >
                <Paperclip size={18} />
              </button>
              <input
                ref={chatFileInputRef}
                type="file"
                hidden
                onChange={uploadChatFile}
              />
              <input
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  if (!editingMsg) notifyTyping();
                }}
                placeholder={
                  uploadingFile
                    ? "Uploading…"
                    : editingMsg
                    ? "Edit your message…"
                    : "Type a message…"
                }
              />
              <button>{editingMsg ? "Save" : "Send"}</button>
            </form>
          </>
        ) : selectedGroup ? (
          <>
            <header className="chat-header">
              <div className="chat-header-left">
                <div className="group-avatar">
                  <Users size={16} />
                </div>
                <div className="chat-header-name">
                  <h3>{selectedGroup.name}</h3>
                  <span className="presence-line">
                    {Object.keys(groupMembers).length} member
                    {Object.keys(groupMembers).length === 1 ? "" : "s"}
                    {groupTyping ? ` · ${groupTyping} is typing…` : ""}
                  </span>
                </div>
              </div>
              <div className="chat-header-right">
                <div className="group-member-avatars">
                  {Object.values(groupMembers)
                    .slice(0, 5)
                    .map((m) => (
                      <Avatar
                        key={m.id}
                        url={m.avatar_url}
                        name={m.username}
                        size="sm"
                      />
                    ))}
                </div>
                <button
                  className="report-user-btn"
                  onClick={leaveGroup}
                  title="Leave group"
                >
                  Leave
                </button>
              </div>
            </header>
            <div className="messages">
              {groupMessages.map((msg) => {
                const mine = msg.sender_id === currentUser.id;
                const isImage = msg.type === "image";
                const deleted = !!msg.deleted_at;
                const sender = groupMembers[msg.sender_id];
                const repliedTo = msg.reply_to
                  ? groupMessages.find((m) => m.id === msg.reply_to)
                  : null;
                return (
                  <div
                    key={msg.id}
                    className={`bubble-wrap ${mine ? "mine" : "theirs"}`}
                  >
                    {!mine && (
                      <span className="group-sender">
                        {sender?.username || "Unknown"}
                      </span>
                    )}
                    {repliedTo && (
                      <div className="reply-quote">
                        <span className="reply-quote-name">
                          {repliedTo.sender_id === currentUser.id
                            ? "You"
                            : groupMembers[repliedTo.sender_id]?.username ||
                              "Unknown"}
                        </span>
                        <span className="reply-quote-text">
                          {repliedTo.deleted_at
                            ? "message removed"
                            : repliedTo.type === "image"
                            ? "Image"
                            : repliedTo.type === "file"
                            ? `📄 ${repliedTo.file_name || "file"}`
                            : repliedTo.content}
                        </span>
                      </div>
                    )}
                    <div
                      className={`bubble ${
                        isImage && !deleted ? "bubble-image" : ""
                      } ${deleted ? "deleted" : ""}`}
                      onTouchStart={() => !deleted && startPress(msg)}
                      onTouchEnd={endPress}
                      onTouchMove={endPress}
                      onMouseDown={() => !deleted && startPress(msg)}
                      onMouseUp={endPress}
                      onMouseLeave={endPress}
                    >
                      {deleted ? (
                        <p className="msg-deleted">🚫 message removed</p>
                      ) : isImage ? (
                        <img
                          className="msg-image"
                          src={msg.content}
                          alt="image"
                          loading="lazy"
                        />
                      ) : msg.type === "file" ? (
                        <a
                          className="file-chip"
                          href={msg.content}
                          target="_blank"
                          rel="noreferrer"
                          download={msg.file_name || true}
                        >
                          <FileIcon size={20} />
                          <span className="file-chip-name">
                            {msg.file_name || "file"}
                          </span>
                          <Download size={15} />
                        </a>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      {!deleted && (
                        <div className="msg-footer">
                          <span>
                            {fmtTime(msg.created_at)}
                            {msg.edited_at ? " · edited" : ""}
                          </span>
                        </div>
                      )}

                      {reactPickerMsg === msg.id && !deleted && (
                        <div className="msg-menu">
                          <div className="msg-menu-actions">
                            <button onClick={() => startReply(msg)}>
                              ↩ Reply
                            </button>
                            {mine && msg.type === "text" && (
                              <button onClick={() => startEdit(msg)}>
                                ✏️ Edit
                              </button>
                            )}
                            {mine && (
                              <button
                                className="danger"
                                onClick={() => deleteMessage(msg)}
                              >
                                🗑️ Unsend
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {groupTyping && (
                <div className="bubble-wrap theirs">
                  <div className="bubble typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
              {reactPickerMsg && (
                <div
                  className="react-overlay"
                  onClick={() => setReactPickerMsg(null)}
                />
              )}
            </div>

            {showEmoji && (
              <div className="emoji-panel">
                {[
                  "😀","😂","😍","🥰","😎","😅","🤔","😴",
                  "😭","😡","😱","🥳","🙏","🔥","🎉","✨",
                  "❤️","💀","💯","👀","👍","👎","🤝","🙌",
                ].map((em) => (
                  <button key={em} type="button" onClick={() => insertEmoji(em)}>
                    {em}
                  </button>
                ))}
              </div>
            )}

            {replyingTo && (
              <div className="reply-bar">
                <div className="reply-bar-text">
                  <strong>
                    Replying to{" "}
                    {replyingTo.sender_id === currentUser.id
                      ? "yourself"
                      : groupMembers[replyingTo.sender_id]?.username || "Unknown"}
                  </strong>
                  <span>
                    {replyingTo.type === "image"
                      ? "Image"
                      : replyingTo.type === "file"
                      ? `📄 ${replyingTo.file_name || "file"}`
                      : replyingTo.content}
                  </span>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)}>
                  <X size={16} />
                </button>
              </div>
            )}

            {editingMsg && (
              <div className="reply-bar editing">
                <div className="reply-bar-text">
                  <strong>Editing message</strong>
                  <span>Press Save to update it</span>
                </div>
                <button type="button" onClick={cancelEdit}>
                  <X size={16} />
                </button>
              </div>
            )}

            <form className="composer" onSubmit={sendGroupMessage}>
              <button
                type="button"
                className={`composer-icon ${showEmoji ? "active" : ""}`}
                onClick={() => setShowEmoji((s) => !s)}
                aria-label="Emoji"
                title="Emoji"
              >
                <Smile size={18} />
              </button>
              <button
                type="button"
                className="composer-icon"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={uploadingFile}
                aria-label="Attach a file"
                title="Attach an image or file"
              >
                <Paperclip size={18} />
              </button>
              <input
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  if (!editingMsg) notifyGroupTyping();
                }}
                placeholder={
                  uploadingFile ? "Uploading…" : "Message the group…"
                }
              />
              <button>{editingMsg ? "Save" : "Send"}</button>
            </form>
          </>
        ) : (
          <div className="empty-chat">
            <h1>Select a friend or group to start Wavo-ing</h1>
          </div>
        )}
      </section>

      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="new-group-card" onClick={(e) => e.stopPropagation()}>
            <div className="new-group-head">
              <h3>New group</h3>
              <button onClick={() => setShowNewGroup(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <input
              className="settings-input"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              maxLength={40}
            />
            <p className="new-group-label">Add friends</p>
            <div className="new-group-friends">
              {friends.length === 0 && (
                <p className="new-group-empty">Add some friends first.</p>
              )}
              {friends.map((f) => {
                const checked = newGroupMembers.includes(f.id);
                return (
                  <button
                    key={f.id}
                    className={`ng-friend ${checked ? "checked" : ""}`}
                    onClick={() =>
                      setNewGroupMembers((prev) =>
                        checked
                          ? prev.filter((id) => id !== f.id)
                          : [...prev, f.id]
                      )
                    }
                  >
                    <Avatar url={f.avatar_url} name={f.username} size="sm" />
                    <span>{displayName(f)}</span>
                    {checked && <Check size={16} />}
                  </button>
                );
              })}
            </div>
            <button
              className="ng-create"
              onClick={createGroup}
              disabled={
                creatingGroup ||
                !newGroupName.trim() ||
                newGroupMembers.length === 0
              }
            >
              {creatingGroup
                ? "Creating…"
                : `Create group${
                    newGroupMembers.length
                      ? ` (${newGroupMembers.length + 1})`
                      : ""
                  }`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
