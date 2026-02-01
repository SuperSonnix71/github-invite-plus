import type { Db } from "./db.js";
import { logger } from "./logger.js";
import { fetchNextQueuedJob, markJobDone, markJobFailed } from "./jobs.js";
import { indexBranch } from "./indexer.js";

interface Worker { start(): void; stop(): Promise<void> }
export type { Worker };

export function createWorker(db: Db): Worker {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const baseIntervalMs = 500;
  let currentIntervalMs = baseIntervalMs;
  const maxIntervalMs = 10_000;
  let tickRunning: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    const job = fetchNextQueuedJob(db);
    if (!job) {
      currentIntervalMs = Math.min(currentIntervalMs * 2, maxIntervalMs);
      schedule();
      return;
    }

    currentIntervalMs = baseIntervalMs;

    try {
      const payload = JSON.parse(job.payload_json) as { githubUserId: number; repoFullName: string; branch: string };
      await indexBranch(db, payload.githubUserId, payload.repoFullName, payload.branch);
      markJobDone(db, job.id);
    } catch (err) {
      logger.warn({ err, jobId: job.id }, "Job failed");
      markJobFailed(db, job.id, err, job.attempts, job.max_attempts);
    }

    schedule();
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      tickRunning = tick().finally(() => { tickRunning = null; });
    }, currentIntervalMs);
    timer.unref();
  }

  function start(): void {
    if (timer) return;
    stopped = false;
    schedule();
    logger.info("Worker started");
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (tickRunning) await tickRunning;
    logger.info("Worker stopped");
  }

  return { start, stop };
}
