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
} from "lucide-react";
import {
  registerServiceWorker,
  ensureNotificationPermission,
  subscribeToPush,
} from "./push";
import Admin from "./Admin";
import "./styles.css";

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY;

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
    age: "",
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, isFocused]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    setSelectedUser(user);
    setShowGiphy(false);
    clearNotifsFromSender(user.id);
  }

  async function insertMessage(content, type) {
    if (!chatId || !selectedUser) return;
    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: currentUser.id,
      receiver_id: selectedUser.id,
      content,
      type,
      is_read: false,
    });
    if (error) alert(error.message);
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = messageText.trim();
    if (!text) return;
    setMessageText("");
    await insertMessage(text, "text");
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
        !auth.age ||
        !auth.username.trim() ||
        !auth.password
      ) {
        alert("Please fill in every field.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auth.email.trim())) {
        alert("Please enter a valid email address.");
        return;
      }
      const ageNum = parseInt(auth.age, 10);
      if (isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
        alert("Please enter a valid age.");
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
        await supabase.from("profiles").insert({
          id: data.user.id,
          username: auth.username.trim(),
          first_name: auth.firstName.trim(),
          last_name: auth.lastName.trim(),
          email: auth.email.trim(),
          age: parseInt(auth.age, 10),
        });
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
                <input
                  type="number"
                  placeholder="Age"
                  min="1"
                  max="120"
                  value={auth.age}
                  onChange={(e) => setAuth({ ...auth, age: e.target.value })}
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
                {(profile?.is_admin || accounts.length > 1) && (
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
              <Avatar url={u.avatar_url} name={u.username} />
              <strong>{u.username}</strong>
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
                <Avatar url={selectedUser.avatar_url} name={selectedUser.username} size="sm" />
                <h3>{selectedUser.username}</h3>
              </div>
              <div className="chat-header-right">
                <button
                  className="report-user-btn"
                  onClick={() => reportUser(selectedUser)}
                  title={`Report ${selectedUser.username}`}
                >
                  <Flag size={14} /> Report
                </button>
                <div className="status-pill">Live</div>
              </div>
            </header>
            <div className="messages">
              {messages.map((msg) => {
                const mine = msg.sender_id === currentUser.id;
                const isImage = msg.type === "image";
                const chips = reactionsFor(msg.id);
                return (
                  <div key={msg.id} className={`bubble-wrap ${mine ? "mine" : "theirs"}`}>
                    <div
                      className={`bubble ${isImage ? "bubble-image" : ""}`}
                      onTouchStart={() => startPress(msg)}
                      onTouchEnd={endPress}
                      onTouchMove={endPress}
                      onMouseDown={() => startPress(msg)}
                      onMouseUp={endPress}
                      onMouseLeave={endPress}
                    >
                      {isImage ? (
                        <img
                          className="msg-image"
                          src={msg.content}
                          alt="GIF"
                          loading="lazy"
                        />
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      <div className="msg-footer">
                        <span>{fmtTime(msg.created_at)}</span>
                        {mine ? (
                          <span className={`receipt ${msg.is_read ? "read" : ""}`}>
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

                      {reactPickerMsg === msg.id && (
                        <div className="react-picker">
                          {["👍", "❤️", "😂", "😮", "😢", "🔥"].map((em) => (
                            <button key={em} onClick={() => addReaction(msg, em)}>
                              {em}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {Object.keys(chips).length > 0 && (
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
              <div ref={bottomRef} />
              {reactPickerMsg && (
                <div className="react-overlay" onClick={() => setReactPickerMsg(null)} />
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
              <input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type a message…"
              />
              <button>Send</button>
            </form>
          </>
        ) : (
          <div className="empty-chat">
            <h1>Select a friend to start Wavo-ing</h1>
          </div>
        )}
      </section>
    </main>
  );
}
