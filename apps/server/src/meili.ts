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

const initializedIndexes = new Set<string>();

export function clearIndexCache(githubUserId: number): void {
    const name = indexNameForUser(githubUserId);
    initializedIndexes.delete(name);
}

export async function ensureIndex(githubUserId: number): Promise<void> {
    const name = indexNameForUser(githubUserId);
    if (initializedIndexes.has(name)) {
        try {
            await meili.getIndex(name);
            return;
        } catch (err: unknown) {
            const isMeiliNotFound =
                typeof err === "object" && err !== null &&
                "code" in err && (err as { code: string }).code === "index_not_found";
            if (isMeiliNotFound) {
                initializedIndexes.delete(name);
            } else {
                throw err;
            }
        }
    }

    try {
        await meili.getIndex(name);
    } catch (err: unknown) {
        const isMeiliNotFound =
            typeof err === "object" && err !== null &&
            "code" in err && (err as { code: string }).code === "index_not_found";
        if (!isMeiliNotFound) throw err;
        const createTask = await meili.createIndex(name, { primaryKey: "id" });
        const createResult = await meili.waitForTask(createTask.taskUid);
        if (createResult.status !== "succeeded") {
            throw new Error(`Failed to create index: ${createResult.status} ${createResult.error?.message ?? ""}`);
        }
    }

    const idx = meili.index(name);
    const settingsTask = await idx.updateSettings({
        searchableAttributes: ["content", "path"],
        filterableAttributes: ["repo", "branch", "path"],
        sortableAttributes: [],
    });
    const settingsResult = await meili.waitForTask(settingsTask.taskUid);
    if (settingsResult.status !== "succeeded") {
        throw new Error(`Failed to update index settings: ${settingsResult.status} ${settingsResult.error?.message ?? ""}`);
    }

    initializedIndexes.add(name);
}
