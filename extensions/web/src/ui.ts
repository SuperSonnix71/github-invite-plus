import type { Invite } from "./types.js";

const STYLE_ID = "gip_style_v2";
const ROOT_ID = "gip_root_v2";
const SPACER_ID = "gip_spacer_v2";

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{position:fixed;top:0;left:0;right:0;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .gip-bar{background:#fff5b1;border-bottom:1px solid #d4b106;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .gip-btn{padding:6px 10px;border-radius:6px;border:1px solid rgba(27,31,36,.2);background:#fff;cursor:pointer;font-size:13px}
    .gip-btn:hover{background:rgba(27,31,36,.04)}
    .gip-btn:disabled{opacity:.5;cursor:default}
    .gip-btn--decline{color:#c00;border-color:#c00}
    .gip-btn--accept{color:#1a7f37;border-color:#1a7f37}
    .gip-panel{background:#fff;border-bottom:1px solid rgba(27,31,36,.15);padding:10px 12px}
    .gip-hidden{display:none}
    .gip-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid rgba(27,31,36,.12);border-radius:8px;margin-top:8px}
    .gip-meta{font-size:12px;opacity:.85}
    .gip-actions{display:flex;gap:6px}
  `;
  document.head.appendChild(style);
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
  }
  return root;
}

function ensureSpacer(height: number): void {
  let spacer = document.getElementById(SPACER_ID);
  if (!spacer) {
    spacer = document.createElement("div");
    spacer.id = SPACER_ID;
    document.body.prepend(spacer);
  }
  spacer.style.height = `${height}px`;
}

function removeSpacer(): void {
  document.getElementById(SPACER_ID)?.remove();
}

export type BannerCallbacks = {
  onRefresh: () => Promise<void>;
  onAccept: (id: number) => Promise<void>;
  onDecline: (id: number) => Promise<void>;
  onOpenOptions: () => void;
  onOpenSearchPanel: () => void;
};

export function renderBanner(invites: Invite[], callbacks: BannerCallbacks): void {
  ensureStyle();
  const root = ensureRoot();
  root.replaceChildren();

  const pending = invites.filter(i => i.status === "pending");
  if (!pending.length) {
    removeSpacer();
    return;
  }

  const bar = document.createElement("div");
  bar.className = "gip-bar";

  const left = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `Pending invitations: ${pending.length}`;
  left.appendChild(strong);

  const actions = document.createElement("div");
  actions.className = "gip-actions";

  const btnRefresh = document.createElement("button");
  btnRefresh.className = "gip-btn";
  btnRefresh.textContent = "Refresh";
  btnRefresh.onclick = async () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = "Refreshing...";
    try { await callbacks.onRefresh(); } catch {} finally {
      btnRefresh.disabled = false;
      btnRefresh.textContent = "Refresh";
    }
  };

  const btnToggle = document.createElement("button");
  btnToggle.className = "gip-btn";
  btnToggle.textContent = "Show";
  btnToggle.onclick = () => {
    const panel = root.querySelector(".gip-panel") as HTMLElement | null;
    if (!panel) return;
    const hidden = panel.classList.toggle("gip-hidden");
    btnToggle.textContent = hidden ? "Show" : "Hide";
    requestAnimationFrame(() => ensureSpacer(root.offsetHeight));
  };

  const btnSearch = document.createElement("button");
  btnSearch.className = "gip-btn";
  btnSearch.textContent = "Branch search";
  btnSearch.onclick = callbacks.onOpenSearchPanel;

  const btnOptions = document.createElement("button");
  btnOptions.className = "gip-btn";
  btnOptions.textContent = "Options";
  btnOptions.onclick = callbacks.onOpenOptions;

  actions.append(btnRefresh, btnToggle, btnSearch, btnOptions);

  const panel = document.createElement("div");
  panel.className = "gip-panel gip-hidden";

  for (const inv of pending) {
    const item = document.createElement("div");
    item.className = "gip-item";

    const info = document.createElement("div");
    const repoLine = document.createElement("div");
    const repoStrong = document.createElement("strong");
    repoStrong.textContent = inv.repository_full_name;
    repoLine.appendChild(repoStrong);

    const metaLine = document.createElement("div");
    metaLine.className = "gip-meta";
    const who = inv.inviter_login ? ` by ${inv.inviter_login}` : "";
    metaLine.textContent = `Invited${who} \u2022 ${new Date(inv.created_at).toLocaleString()}`;

    info.append(repoLine, metaLine);

    const right = document.createElement("div");
    right.className = "gip-actions";

    const a = document.createElement("button");
    a.className = "gip-btn gip-btn--accept";
    a.textContent = "Accept";
    a.onclick = async () => {
      a.disabled = true;
      a.textContent = "Accepting...";
      await callbacks.onAccept(inv.invite_id);
    };

    const d = document.createElement("button");
    d.className = "gip-btn gip-btn--decline";
    d.textContent = "Decline";
    d.onclick = async () => {
      if (!confirm(`Decline invitation to ${inv.repository_full_name}?`)) return;
      d.disabled = true;
      d.textContent = "Declining...";
      await callbacks.onDecline(inv.invite_id);
    };

    right.append(a, d);
    item.append(info, right);
    panel.appendChild(item);
  }

  bar.append(left, actions);
  root.append(bar, panel);

  requestAnimationFrame(() => ensureSpacer(root.offsetHeight));
}
