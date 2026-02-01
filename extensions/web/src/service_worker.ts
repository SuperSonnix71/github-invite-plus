import { apiFetch } from "./http.js";

async function refreshInvites(): Promise<number | null> {
  try {
    const r = await apiFetch("/api/invites/refresh", { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) return null;
    const j = await r.json();
    return Number(j.pendingCount ?? 0);
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("gip_refresh", { periodInMinutes: 3 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "gip_refresh") return;
  void refreshInvites().then((n) => {
    if (n === null) {
      chrome.action.setBadgeText({ text: "!" });
      return;
    }
    chrome.action.setBadgeText({ text: n ? String(n) : "" });
  });
});

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === "GIP_REFRESH_NOW") {
    void refreshInvites().then((n) => sendResponse({ ok: n !== null, pendingCount: n ?? 0 }));
    return true;
  }
  return false;
});
