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
 *   /login           -> landing/login form
 *   /signup          -> landing/signup form
 *   /chats           -> main chat app
 *   /chats/:username -> main chat app with that user's DM open
 *   /support         -> dedicated Wavo Support AI
 *   /admin           -> admin dashboard (falls back to /chats if not admin)
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
  setSelectedUserByUsername,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const didInit = useRef(false);

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
      setView("admin");
    } else if (path.toLowerCase() === "/chats/support") {
      navigate("/support", { replace: true });
    } else if (path.startsWith("/chats/")) {
      const username = decodeURIComponent(path.replace("/chats/", ""));
      setView("chat");
      if (username && setSelectedUserByUsername) {
        setSelectedUserByUsername(username);
      }
    } else if (path === "/chats") {
      setView("chat");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInit.current) return;

    let next;

    if (selectedUser?.username?.toLowerCase() === "support") {
      next = "/support";
    } else if (!session) {
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
