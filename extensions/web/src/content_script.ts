import { apiFetch } from "./http.js";
import { renderBanner, type BannerCallbacks } from "./ui.js";
import { openSearchPanel } from "./search_panel.js";
import type { Invite } from "./types.js";

const RENDERED_FLAG = "gip_rendered_v2";

async function loadInvites(): Promise<Invite[]> {
  const r = await apiFetch("/api/invites", { method: "GET" });
  if (!r.ok) throw new Error("Not authenticated");
  const j = await r.json() as { invites: Invite[] };
  return j.invites ?? [];
}

async function refreshNow(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "GIP_REFRESH_NOW" });
}

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

async function rerender(): Promise<void> {
  const invites = await loadInvites();
  renderBanner(invites, callbacks);
}

const callbacks: BannerCallbacks = {
  onRefresh: async () => {
    await refreshNow();
    await rerender();
  },
  onAccept: async (id) => {
    const r = await apiFetch(`/api/invites/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) alert("Accept failed");
    await refreshNow();
    await rerender();
  },
  onDecline: async (id) => {
    const r = await apiFetch(`/api/invites/${id}/decline`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) alert("Decline failed");
    await refreshNow();
    await rerender();
  },
  onOpenOptions: openOptions,
  onOpenSearchPanel: openSearchPanel,
};

async function main(): Promise<void> {
  if (document.documentElement.hasAttribute(RENDERED_FLAG)) return;
  document.documentElement.setAttribute(RENDERED_FLAG, "1");

  try {
    await refreshNow();
    await rerender();
  } catch {}
}

void main();
