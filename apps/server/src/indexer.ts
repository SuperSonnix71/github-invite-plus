import type { Db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { getValidAccessToken } from "./tokens.js";
import { ensureIndex, indexNameForUser, type CodeDoc, meili } from "./meili.js";
import { getBranchHeadSha, getRepoTreeRecursive, getBlobText } from "./github.js";
import { sanitizeMeiliValue } from "./validate.js";

const DENY_EXTS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".7z",
    ".mp4", ".mov", ".mp3", ".wav", ".ttf", ".otf", ".woff", ".woff2", ".exe", ".dll",
    ".bmp", ".tiff", ".svg", ".eot", ".jar", ".war", ".so", ".dylib", ".bin", ".img",
]);

function isProbablyTextPath(path: string): boolean {
    const lower = path.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    if (dotIdx === -1) return true;
    return !DENY_EXTS.has(lower.slice(dotIdx));
}

export async function indexBranch(db: Db, githubUserId: number, repoFullName: string, branch: string): Promise<void> {
    try {
        await ensureIndex(githubUserId);
        const idx = meili.index(indexNameForUser(githubUserId));

        const accessToken = await getValidAccessToken(db, githubUserId);
        const headSha = await getBranchHeadSha(accessToken, repoFullName, branch);

        db.prepare(
            `INSERT INTO repo_branch_index_state(github_user_id, repo_full_name, branch, head_sha, indexed_at, status)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(github_user_id, repo_full_name, branch) DO UPDATE SET
           head_sha=excluded.head_sha, indexed_at=excluded.indexed_at, status=excluded.status, last_error=NULL`
        ).run(githubUserId, repoFullName, branch, headSha, Date.now(), "indexing");

        const entries = await getRepoTreeRecursive(accessToken, repoFullName, headSha);

        const blobs = entries.filter(e => e.type === "blob" && isProbablyTextPath(e.path));
        if (blobs.length > env.MAX_INDEX_FILES_PER_BRANCH) {
            throw new Error(`Too many files to index (${blobs.length} blobs, max ${env.MAX_INDEX_FILES_PER_BRANCH})`);
        }

        logger.info({ githubUserId, repoFullName, branch, blobs: blobs.length }, "Indexing branch");

        const safeRepo = sanitizeMeiliValue(repoFullName);
        const safeBranch = sanitizeMeiliValue(branch);
        const deleteTask = await idx.deleteDocuments({ filter: `repo = "${safeRepo}" AND branch = "${safeBranch}"` });
        const deleteResult = await idx.waitForTask(deleteTask.taskUid);
        if (deleteResult.status !== "succeeded") {
            throw new Error(`Meilisearch delete task ${deleteTask.taskUid} failed: ${deleteResult.error?.message ?? "unknown error"}`);
        }

        const batchSize = 500;
        const taskUids: number[] = [];
        const concurrency = env.INDEX_CONCURRENCY;
        let cursor = 0;
        let totalIndexed = 0;
        let totalSkipped = 0;
        const maxBatchBytes = 10 * 1024 * 1024;

        async function worker(): Promise<void> {
            const localDocs: CodeDoc[] = [];
            let localBytes = 0;
            let skipped = 0;
            while (true) {
                const cur = cursor++;
                if (cur >= blobs.length) break;
                const b = blobs[cur];
                if (!b) break;
                if ((b.size ?? 0) > env.MAX_BLOB_BYTES) { skipped++; continue; }
                try {
                    const { text, bytes } = await getBlobText(accessToken, repoFullName, b.sha);
                    if (bytes > env.MAX_BLOB_BYTES) { skipped++; continue; }
                    localDocs.push({
                        id: `${repoFullName}:${branch}:${b.path}`,
                        repo: repoFullName,
                        branch,
                        path: b.path,
                        sha: b.sha,
                        content: text,
                    });
                    localBytes += bytes;
                    if (localDocs.length >= batchSize || localBytes >= maxBatchBytes) {
                        const batch = localDocs.splice(0);
                        const task = await idx.addDocuments(batch);
                        taskUids.push(task.taskUid);
                        totalIndexed += batch.length;
                        localBytes = 0;
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg === "Binary blob" || msg === "Unsupported blob encoding") {
                        skipped++;
                    } else {
                        logger.warn({ err, path: b.path, repoFullName, branch }, "Blob fetch failed during indexing");
                        skipped++;
                    }
                }
            }
            if (localDocs.length > 0) {
                const task = await idx.addDocuments(localDocs);
                taskUids.push(task.taskUid);
                totalIndexed += localDocs.length;
            }
            totalSkipped += skipped;
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        for (const uid of taskUids) {
            const task = await idx.waitForTask(uid);
            if (task.status === "failed") {
                throw new Error(`Meilisearch task ${uid} failed: ${task.error?.message ?? "unknown error"}`);
            }
        }

        db.prepare(
            `UPDATE repo_branch_index_state
         SET indexed_at=?, status='indexed', last_error=NULL
         WHERE github_user_id=? AND repo_full_name=? AND branch=?`
        ).run(Date.now(), githubUserId, repoFullName, branch);

        logger.info({ githubUserId, repoFullName, branch, indexedDocs: totalIndexed, skipped: totalSkipped }, "Indexing complete");
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        db.prepare(
            `UPDATE repo_branch_index_state
         SET status='failed', last_error=?
         WHERE github_user_id=? AND repo_full_name=? AND branch=?`
        ).run(errMsg, githubUserId, repoFullName, branch);
        logger.error({ err, githubUserId, repoFullName, branch }, "Indexing failed");
        throw err;
    }
}
