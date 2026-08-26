import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import Admin from "./Admin";

export default function AdminRoute() {
  const [state, setState] = useState({ loading: true, profile: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return alive && setState({ loading: false, profile: null });
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, username, is_admin")
        .eq("id", session.user.id)
        .single();
      if (!alive) return;
      if (error || profile?.is_admin !== true) setState({ loading: false, profile: null });
      else setState({ loading: false, profile });
    })();
    return () => { alive = false; };
  }, []);

  if (state.loading) return <main className="splash"><div className="wavo-mark">W</div><span>Checking admin access…</span></main>;
  if (!state.profile) return <Navigate to="/" replace />;
  return <Admin me={state.profile} onBack={() => { window.location.href = "/"; }} />;
}
