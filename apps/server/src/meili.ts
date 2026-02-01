import { MeiliSearch } from "meilisearch";
import { env } from "./env.js";

export const meili = new MeiliSearch({
  host: env.MEILI_URL,
  apiKey: env.MEILI_MASTER_KEY,
});

export interface CodeDoc {
  id: string;
  repo: string;
  branch: string;
  path: string;
  sha: string;
  content: string;
}

export function indexNameForUser(githubUserId: number): string {
  return `code_u_${githubUserId}`;
}

const ensuredIndexes = new Set<number>();

export async function ensureIndex(githubUserId: number): Promise<void> {
  const name = indexNameForUser(githubUserId);
  try {
    await meili.getIndex(name);
  } catch (err: unknown) {
    const isMeiliNotFound =
      typeof err === "object" && err !== null &&
      "code" in err && (err as { code: string }).code === "index_not_found";
    if (!isMeiliNotFound) throw err;
    await meili.createIndex(name, { primaryKey: "id" });
  }

  const idx = meili.index(name);
  await idx.updateSettings({
    searchableAttributes: ["content", "path"],
    filterableAttributes: ["repo", "branch", "path"],
    sortableAttributes: [],
  });
}

export async function ensureIndexCached(githubUserId: number): Promise<void> {
  if (ensuredIndexes.has(githubUserId)) return;
  await ensureIndex(githubUserId);
  ensuredIndexes.add(githubUserId);
}
