import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * useUrlSync
 *
 * Wavo has always been one screen that flips between login/signup/chat/admin
 * using plain React state — there was never a real URL for any of them.
 * This hook is a thin bridge, not a rewrite: it reads the URL once on load
 * to set the right screen, and pushes a new URL whenever the screen changes.
 * None of your existing render logic (the big if/return blocks in App.jsx)
 * needs to change — they still just look at session/showAuth/mode/view.
 *
 * Routes:
 *   /login          -> landing/login form
 *   /signup         -> landing/signup form
 *   /chats          -> main chat app
 *   /chats/:username -> main chat app with that user's DM open
 *   /admin          -> admin dashboard (falls back to /chats if not admin)
 */
export function useUrlSync({
  session,
  profile,
  showAuth,
  setShowAuth,
  mode,
  setMode,
  view,
  setView,
  selectedUser,
  setSelectedUserByUsername, // async fn: (username) => void, looks the user up
  friends, // used to resolve :username -> user object once friends load
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const didInit = useRef(false);

  // 1. On first load, read the URL and set initial screen state from it.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const path = location.pathname;

    if (path === "/signup") {
      setShowAuth(true);
      setMode("signup");
    } else if (path === "/login") {
      setShowAuth(true);
      setMode("login");
    } else if (path === "/admin") {
      setView("admin"); // the existing `profile?.is_admin` check still gates access
    } else if (path.startsWith("/chats/")) {
      const username = decodeURIComponent(path.replace("/chats/", ""));
      setView("chat");
      if (username && setSelectedUserByUsername) {
        setSelectedUserByUsername(username);
      }
    } else if (path === "/chats") {
      setView("chat");
    }
    // Any other path (e.g. "/") just leaves the existing defaults alone —
    // Landing page shows for logged-out users, chat shows for logged-in ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Whenever the screen actually changes, push the matching URL.
  //    `replace: true` so the back button steps between real navigations
  //    (e.g. login -> chats) instead of every keystroke in a form.
  useEffect(() => {
    if (!didInit.current) return; // don't fight step 1 on the very first render

    let next = "/";

    if (!session) {
      if (showAuth) {
        next = mode === "signup" ? "/signup" : "/login";
      } else {
        next = "/";
      }
    } else if (view === "admin" && profile?.is_admin) {
      next = "/admin";
    } else {
      next = selectedUser?.username
        ? `/chats/${encodeURIComponent(selectedUser.username)}`
        : "/chats";
    }

    if (next !== location.pathname) {
      navigate(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, showAuth, mode, view, profile?.is_admin, selectedUser?.username]);
}
