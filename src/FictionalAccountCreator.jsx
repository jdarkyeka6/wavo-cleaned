import { useState } from "react";
import { supabase } from "./supabaseClient";

const emptyRow = () => ({ username: "", first_name: "", last_name: "", bio: "" });

export default function FictionalAccountCreator() {
  const [rows, setRows] = useState([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  function update(index, key, value) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }

  function addRow() {
    setRows((current) => current.length >= 50 ? current : [...current, emptyRow()]);
  }

  async function submit(e) {
    e.preventDefault();
    const accounts = rows
      .map((row) => ({ ...row, username: row.username.trim().replace(/^@/, "").toLowerCase(), first_name: row.first_name.trim(), last_name: row.last_name.trim(), bio: row.bio.trim() }))
      .filter((row) => row.username);
    if (!accounts.length) return setResult("Add at least one username.");
    setBusy(true);
    setResult("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const response = await fetch("/api/admin/create-fictional-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ accounts }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Creation failed");
      setResult(`Created ${payload.created?.length || accounts.length} fictional account${accounts.length === 1 ? "" : "s"}.`);
      setRows([emptyRow()]);
    } catch (error) {
      console.error("[wavo admin] fictional accounts", error);
      setResult(error.message || "Couldn't create accounts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <div className="section-heading"><div><span className="eyebrow">CANON TOOLS</span><h2>📚 Fictional character accounts</h2><p>Create controlled Wavo accounts for Tidefall and other fictional characters. Admin only.</p></div></div>
      <form className="settings-card" onSubmit={submit}>
        {rows.map((row, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 2fr auto", gap: ".5rem", alignItems: "end", marginBottom: ".65rem" }}>
            <label>@ username<input required={index === 0} value={row.username} onChange={(e) => update(index, "username", e.target.value)} placeholder="lilyhart" /></label>
            <label>First name<input value={row.first_name} onChange={(e) => update(index, "first_name", e.target.value)} placeholder="Lily" /></label>
            <label>Last name<input value={row.last_name} onChange={(e) => update(index, "last_name", e.target.value)} placeholder="Hart" /></label>
            <label>Bio<input value={row.bio} onChange={(e) => update(index, "bio", e.target.value)} placeholder="Optional" /></label>
            {rows.length > 1 && <button type="button" className="danger-soft" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove</button>}
          </div>
        ))}
        <div className="button-row">
          <button type="button" className="secondary-btn" onClick={addRow} disabled={rows.length >= 50}>+ Add character</button>
          <button className="primary-btn" disabled={busy}>{busy ? "Creating…" : `Create ${rows.filter((r) => r.username.trim()).length || ""} account${rows.filter((r) => r.username.trim()).length === 1 ? "" : "s"}`}</button>
        </div>
        {result && <div className="form-note">{result}</div>}
      </form>
    </section>
  );
}
