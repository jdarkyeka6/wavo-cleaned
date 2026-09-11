import { supabase } from "./supabaseClient";

const STYLE_ID = "wavo-account-deletion-styles";
const SECTION_ATTR = "data-wavo-account-controls";

function addStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${SECTION_ATTR}] .wavo-account-row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
    [${SECTION_ATTR}] .wavo-account-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
    [${SECTION_ATTR}] .wavo-account-copy strong{font-size:15px}
    [${SECTION_ATTR}] .wavo-account-copy span{opacity:.72;font-size:13px;line-height:1.35}
    .wavo-delete-account-btn{border:1px solid rgba(255,84,104,.38)!important;background:rgba(255,84,104,.1)!important;color:#ff6679!important;border-radius:12px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}
    .wavo-delete-account-btn:active{transform:scale(.98)}
    .wavo-delete-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(7,8,13,.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;padding:18px;padding-bottom:max(18px,env(safe-area-inset-bottom))}
    .wavo-delete-dialog{width:min(100%,520px);max-height:min(88vh,760px);overflow:auto;background:#181922;color:#fff;border:1px solid rgba(255,255,255,.1);box-shadow:0 28px 80px rgba(0,0,0,.48);border-radius:24px;padding:22px}
    .wavo-delete-dialog h2{font-size:24px;margin:0 0 8px}
    .wavo-delete-dialog p{margin:0 0 14px;color:rgba(255,255,255,.76);line-height:1.5}
    .wavo-delete-dialog ul{margin:0 0 16px;padding-left:20px;color:rgba(255,255,255,.76);line-height:1.5}
    .wavo-delete-warning{padding:13px 14px;border-radius:14px;background:rgba(255,84,104,.09);border:1px solid rgba(255,84,104,.22);font-size:13px;line-height:1.45;margin:14px 0}
    .wavo-delete-dialog label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:700;margin:16px 0}
    .wavo-delete-dialog input{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:#101118;color:#fff;font:inherit;padding:13px 14px;outline:none}
    .wavo-delete-dialog input:focus{border-color:rgba(255,255,255,.42)}
    .wavo-delete-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
    .wavo-delete-actions button{min-height:48px;border-radius:13px;border:1px solid rgba(255,255,255,.13);font:inherit;font-weight:800;cursor:pointer}
    .wavo-delete-cancel{background:rgba(255,255,255,.06);color:#fff}
    .wavo-delete-confirm{background:#e83f57;color:#fff;border-color:#e83f57!important}
    .wavo-delete-confirm:disabled{opacity:.38;cursor:not-allowed}
    .wavo-delete-status{min-height:20px;font-size:13px;margin-top:10px;color:#ff8796}
    @media(min-width:700px){.wavo-delete-overlay{align-items:center}.wavo-delete-dialog{border-radius:24px}}
  `;
  document.head.appendChild(style);
}

function clearWavoLocalData() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("wavo:")) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {}
}

function openDeleteDialog() {
  if (document.querySelector(".wavo-delete-overlay")) return;

  const overlay = document.createElement("div");
  overlay.className = "wavo-delete-overlay";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `
    <section class="wavo-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="wavo-delete-title">
      <h2 id="wavo-delete-title">Delete Wavo account?</h2>
      <p>This permanently deletes your Wavo account and the personal data linked to it. This cannot be undone.</p>
      <ul>
        <li>Your profile and sign-in account are deleted.</li>
        <li>Your messages, posts, Waves, reactions, friendships, settings and account-owned uploads are removed.</li>
        <li>Shared Spaces may remain for other members, but your membership and user-linked content are removed.</li>
      </ul>
      <div class="wavo-delete-warning"><strong>Subscriptions:</strong> deleting your Wavo account does not automatically cancel an App Store subscription. You can manage App Store subscriptions in Apple Settings.</div>
      <label>Type <strong>DELETE</strong> to confirm
        <input class="wavo-delete-input" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-describedby="wavo-delete-status" />
      </label>
      <div class="wavo-delete-actions">
        <button type="button" class="wavo-delete-cancel">Cancel</button>
        <button type="button" class="wavo-delete-confirm" disabled>Delete account</button>
      </div>
      <div id="wavo-delete-status" class="wavo-delete-status" role="status" aria-live="polite"></div>
    </section>
  `;

  document.body.appendChild(overlay);
  const input = overlay.querySelector(".wavo-delete-input");
  const cancel = overlay.querySelector(".wavo-delete-cancel");
  const confirm = overlay.querySelector(".wavo-delete-confirm");
  const status = overlay.querySelector(".wavo-delete-status");
  let busy = false;

  const close = () => {
    if (busy) return;
    overlay.remove();
  };

  input.addEventListener("input", () => {
    confirm.disabled = input.value.trim() !== "DELETE" || busy;
  });
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", function esc(event) {
    if (!overlay.isConnected) return document.removeEventListener("keydown", esc);
    if (event.key === "Escape") close();
  });

  confirm.addEventListener("click", async () => {
    if (input.value.trim() !== "DELETE" || busy) return;
    busy = true;
    input.disabled = true;
    cancel.disabled = true;
    confirm.disabled = true;
    confirm.textContent = "Deleting…";
    status.textContent = "Permanently deleting your Wavo account…";

    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { confirmation: "DELETE" },
      });
      if (error || !data?.deleted) throw error || new Error("Account deletion did not complete");

      clearWavoLocalData();
      try { await supabase.auth.signOut({ scope: "local" }); } catch {}
      status.style.color = "#82e8aa";
      status.textContent = "Account deleted. You are signed out.";
      confirm.textContent = "Deleted";
      window.setTimeout(() => window.location.assign("/"), 700);
    } catch (error) {
      console.error("[wavo] account deletion", error);
      busy = false;
      input.disabled = false;
      cancel.disabled = false;
      confirm.disabled = input.value.trim() !== "DELETE";
      confirm.textContent = "Delete account";
      status.textContent = "Wavo couldn't delete your account. Nothing was partially deleted. Try again.";
      input.focus();
    }
  });

  window.setTimeout(() => input.focus(), 30);
}

function mountAccountControls() {
  const logout = document.querySelector("button.logout-button");
  if (!logout || document.querySelector(`[${SECTION_ATTR}]`)) return;

  const section = document.createElement("section");
  section.className = "settings-card";
  section.setAttribute(SECTION_ATTR, "");
  section.innerHTML = `
    <div class="wavo-account-row">
      <div class="wavo-account-copy">
        <strong>Account</strong>
        <span>Manage your Wavo account and permanently delete your data.</span>
      </div>
      <button type="button" class="wavo-delete-account-btn">Delete account</button>
    </div>
  `;
  section.querySelector(".wavo-delete-account-btn").addEventListener("click", openDeleteDialog);
  logout.before(section);
}

addStyles();
mountAccountControls();
const observer = new MutationObserver(mountAccountControls);
observer.observe(document.documentElement, { childList: true, subtree: true });
