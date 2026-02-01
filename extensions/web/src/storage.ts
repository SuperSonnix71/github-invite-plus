export type Settings = {
  serverBaseUrl: string;
  csrfToken?: string;
  githubLogin?: string;
};

const KEY = "gip_settings_v2";

export async function getSettings(): Promise<Settings | null> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as Settings | undefined) ?? null;
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
