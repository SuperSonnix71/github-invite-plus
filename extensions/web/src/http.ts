import { getSettings } from "./storage.js";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const s = await getSettings();
  if (!s?.serverBaseUrl) throw new Error("Not configured. Open extension options to connect.");

  const url = new URL(path, s.serverBaseUrl).toString();
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (s.csrfToken) headers.set("x-csrf-token", s.csrfToken);

  return fetch(url, {
    ...init,
    headers,
    credentials: "include" // session cookie
  });
}
