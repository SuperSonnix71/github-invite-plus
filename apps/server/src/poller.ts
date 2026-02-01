import type { Db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { refreshInvites } from "./invites.js";
import { periodicCleanup } from "./db.js";

interface Poller { start(): void; stop(): Promise<void> }
export type { Poller };

const CONCURRENCY = 3;

export function createInvitePoller(db: Db): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let tickRunning: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    periodicCleanup(db);
    const users = db.prepare("SELECT github_user_id FROM users").all() as { github_user_id: number }[];

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(u => refreshInvites(db, u.github_user_id))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const batchUser = batch[j];
        if (r?.status === "rejected" && batchUser) {
          logger.warn({ err: r.reason as unknown, githubUserId: batchUser.github_user_id }, "Invite refresh failed");
        }
      }
    }
  }

  function schedule(): void {
    if (stopped) return;
    const intervalMs = env.INVITE_POLL_INTERVAL_SECONDS * 1000;
    timer = setTimeout(() => {
      tickRunning = tick().finally(() => {
        tickRunning = null;
        schedule();
      });
    }, intervalMs);
    timer.unref();
  }

  function start(): void {
    if (timer) return;
    stopped = false;
    logger.info({ intervalSeconds: env.INVITE_POLL_INTERVAL_SECONDS }, "Invite poller started");
    tickRunning = tick().finally(() => {
      tickRunning = null;
      schedule();
    });
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (tickRunning) await tickRunning;
    logger.info("Invite poller stopped");
  }

  return { start, stop };
}
