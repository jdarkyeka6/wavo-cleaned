import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "./supabaseClient";
import Admin from "./Admin";

export default function AdminRoute() {
  const [state, setState] = useState({ loading: true, profile: null, error: "" });

  const checkAccess = useCallback(async () => {
    setState({ loading: true, profile: null, error: "" });

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData?.user;

      if (!user?.id) {
        setState({ loading: false, profile: null, error: "You are signed out." });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, is_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) {
        setState({ loading: false, profile: null, error: "Your Wavo profile could not be found." });
        return;
      }
      if (profile.is_admin !== true) {
        setState({ loading: false, profile: null, error: "This account does not have Wavo Admin access." });
        return;
      }

      setState({ loading: false, profile, error: "" });
    } catch (error) {
      console.error("[wavo admin route]", error);
      setState({
        loading: false,
        profile: null,
        error: error?.message || "Wavo could not verify admin access.",
      });
    }
  }, []);

  useEffect(() => {
    void checkAccess();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void checkAccess();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [checkAccess]);

  if (state.loading) {
    return (
      <main className="admin-route-state">
        <section className="admin-route-card">
          <ShieldCheck size={30} />
          <h1>Checking admin access…</h1>
          <p>Verifying this account with Wavo.</p>
        </section>
      </main>
    );
  }

  if (!state.profile) {
    return (
      <main className="admin-route-state">
        <section className="admin-route-card">
          <ShieldCheck size={30} />
          <h1>Admin didn’t open</h1>
          <p>{state.error || "Wavo could not verify admin access."}</p>
          <div className="admin-route-actions">
            <button type="button" onClick={() => void checkAccess()}>Retry</button>
            <a href="/">Back to Wavo</a>
          </div>
        </section>
      </main>
    );
  }

  return <Admin me={state.profile} onBack={() => { window.location.href = "/"; }} />;
}
