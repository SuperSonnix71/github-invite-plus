import type { Db } from "./db.js";
import { nanoid } from "nanoid";
import { logger } from "./logger.js";

export type JobType = "index_branch";

export function recoverStuckJobs(db: Db): void {
    const result = db.prepare(
        "UPDATE jobs SET status='queued' WHERE status='running'"
    ).run();
    if (result.changes > 0) {
        logger.info({ recoveredJobs: result.changes }, "Recovered stuck running jobs on startup");
    }
}

export interface IndexBranchPayload {
    githubUserId: number;
    repoFullName: string;
    branch: string;
}

export function enqueueIndexBranch(db: Db, payload: IndexBranchPayload): string {
    const existing = db.prepare(
        "SELECT id FROM jobs WHERE type='index_branch' AND payload_json=? AND status IN ('queued','running')"
    ).get(JSON.stringify(payload)) as { id: string } | undefined;

    if (existing) {
        logger.info({ id: existing.id, payload }, "Job already queued or running, skipping duplicate");
        return existing.id;
    }

    const id = nanoid(24);
    const now = Date.now();
    db.prepare(
        "INSERT INTO jobs(id, type, payload_json, status, attempts, max_attempts, created_at, updated_at) VALUES(?,?,?,?,0,3,?,?)"
    ).run(id, "index_branch", JSON.stringify(payload), "queued", now, now);
    logger.info({ id, payload }, "Job queued: index_branch");
    return id;
}

interface QueuedJob { id: string; type: JobType; payload_json: string; attempts: number; max_attempts: number }

export function fetchNextQueuedJob(db: Db): QueuedJob | null {
    const now = Date.now();
    const row = db.prepare(
        `UPDATE jobs SET status='running', updated_at=?
     WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1)
     RETURNING id, type, payload_json, attempts, max_attempts`
    ).get(now) as QueuedJob | undefined;
    return row ?? null;
}

export function markJobDone(db: Db, id: string): void {
    db.prepare("UPDATE jobs SET status='done', updated_at=? WHERE id=?").run(Date.now(), id);
}

export function markJobFailed(db: Db, id: string, err: unknown, attempts: number, maxAttempts: number): void {
    const msg = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    if (attempts + 1 >= maxAttempts) {
        db.prepare("UPDATE jobs SET status='failed', attempts=?, updated_at=?, last_error=? WHERE id=?")
            .run(attempts + 1, now, msg, id);
        return;
    }
    db.prepare("UPDATE jobs SET status='queued', attempts=?, updated_at=?, last_error=? WHERE id=?")
        .run(attempts + 1, now, msg, id);
}
