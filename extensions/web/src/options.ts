import { apiFetch } from "./http.js";
import { getSettings, setSettings, clearSettings } from "./storage.js";
import type { ApiMe } from "./types.js";

const serverInput = document.getElementById("server") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

const connectBtn = document.getElementById("connect") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout") as HTMLButtonElement;
const refreshMeBtn = document.getElementById("refreshMe") as HTMLButtonElement;

const repoInput = document.getElementById("repo") as HTMLInputElement;
const branchInput = document.getElementById("branch") as HTMLInputElement;
const indexBranchBtn = document.getElementById("indexBranch") as HTMLButtonElement;

function setStatusOk(msg: string) { statusEl.textContent = msg; statusEl.className = "ok"; }
function setStatusErr(msg: string) { statusEl.textContent = msg; statusEl.className = "err"; }

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function refreshMe(): Promise<void> {
  try {
    const r = await apiFetch("/api/me", { method: "GET" });
    if (!r.ok) { setStatusErr("Not connected"); return; }
    const me = (await r.json()) as ApiMe;

    const s = (await getSettings()) ?? { serverBaseUrl: serverInput.value.trim() };
    await setSettings({
      serverBaseUrl: s.serverBaseUrl,
      csrfToken: me.csrfToken,
      githubLogin: me.githubLogin,
    });

    setStatusOk(`Connected as ${me.githubLogin}`);
  } catch {
    setStatusErr("Not connected");
  }
}

connectBtn.onclick = async () => {
  const base = serverInput.value.trim();
  if (!base || !isValidUrl(base)) { setStatusErr("Enter a valid backend URL (https://...)"); return; }

  const redirectUri = chrome.identity.getRedirectURL("provider_cb");
  let startRes: Response;
  try {
    startRes = await fetch(new URL("/auth/start", base).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUri }),
    });
  } catch {
    setStatusErr("Cannot reach backend. Check URL.");
    return;
  }

  if (!startRes.ok) { setStatusErr("Auth start failed"); return; }
  const start = await startRes.json() as { authorizeUrl?: string; state?: string };
  const authorizeUrl = start.authorizeUrl ?? "";
  const state = start.state ?? "";
  if (!authorizeUrl || !state) { setStatusErr("Auth start invalid response"); return; }

  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true });
  if (!callbackUrl) { setStatusErr("Auth canceled"); return; }

  const cb = new URL(callbackUrl);
  const code = cb.searchParams.get("code") ?? "";
  const returnedState = cb.searchParams.get("state") ?? "";
  if (!code || !returnedState) { setStatusErr("Missing code/state"); return; }
  if (returnedState !== state) { setStatusErr("State mismatch"); return; }

  const exRes = await fetch(new URL("/auth/exchange", base).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, state, redirectUri }),
  });

  if (!exRes.ok) {
    const j = await exRes.json().catch(() => ({})) as { error?: string };
    setStatusErr(j.error ?? "Auth exchange failed");
    return;
  }

  const exBody = await exRes.json().catch(() => ({})) as { csrfToken?: string };
  await setSettings({ serverBaseUrl: base, ...(exBody.csrfToken ? { csrfToken: exBody.csrfToken } : {}) });
  await refreshMe();
};

logoutBtn.onclick = async () => {
  try {
    await apiFetch("/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {}
  await clearSettings();
  setStatusErr("Logged out");
};

refreshMeBtn.onclick = async () => {
  await refreshMe();
};

indexBranchBtn.onclick = async () => {
  const repoFullName = repoInput.value.trim();
  const branch = branchInput.value.trim();
  if (!repoFullName || !branch) { alert("Repo and branch required"); return; }
  const r = await apiFetch("/api/index/branch", { method: "POST", body: JSON.stringify({ repoFullName, branch }) });
  if (!r.ok) { alert("Index request failed (auth/csrf)"); return; }
  const j = await r.json() as { jobId: string };
  alert(`Index job queued: ${j.jobId}`);
};

(async () => {
  const s = await getSettings();
  if (s?.serverBaseUrl) serverInput.value = s.serverBaseUrl;
  await refreshMe();
})();
