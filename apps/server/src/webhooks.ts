import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import type { Db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { enqueueIndexBranch } from "./jobs.js";
import { meili, indexNameForUser, clearIndexCache } from "./meili.js";
import { sanitizeMeiliValue } from "./validate.js";

function verifySignature(payload: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function bodyStr(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v : "";
}

function bodyObj(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  return typeof v === "object" && v !== null ? v as Record<string, unknown> : undefined;
}

export function createWebhookRouter(db: Db): Router {
  const r = Router();

  r.post("/github", (req: Request, res: Response) => {
    const secret = env.WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ ok: false, error: "Webhooks not configured" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({ ok: false, error: "Missing raw body" });
      return;
    }

    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifySignature(rawBody, sig, secret)) {
      logger.warn("Webhook signature verification failed");
      res.status(401).json({ ok: false, error: "Invalid signature" });
      return;
    }

    const event = req.headers["x-github-event"] as string | undefined;
    const body = req.body as Record<string, unknown>;

    try {
      if (event === "push") {
        handlePush(db, body);
      } else if (event === "repository") {
        handleRepository(db, body);
      } else if (event === "github_app_authorization") {
        handleAppAuthRevoked(db, body);
      } else {
        logger.info({ event }, "Unhandled webhook event");
      }
      res.status(200).json({ ok: true });
    } catch (err: unknown) {
      logger.error({ err, event }, "Webhook handler error");
      res.status(500).json({ ok: false, error: "Webhook processing failed" });
    }
  });

  return r;
}

function handlePush(db: Db, body: Record<string, unknown>): void {
  const ref = bodyStr(body, "ref");
  const deleted = body.deleted === true;
  const repoObj = bodyObj(body, "repository");
  const repoFullName = repoObj ? bodyStr(repoObj, "full_name") : "";
  const sender = bodyObj(body, "sender");
  const senderLogin = sender ? bodyStr(sender, "login") : "";

  if (!ref.startsWith("refs/heads/") || !repoFullName) return;

  const branch = ref.replace("refs/heads/", "");

  if (deleted) {
    const rows = db.prepare(
      "SELECT github_user_id FROM repo_branch_index_state WHERE repo_full_name=? AND branch=?"
    ).all(repoFullName, branch) as { github_user_id: number }[];

    for (const row of rows) {
      const idx = meili.index(indexNameForUser(row.github_user_id));
      const filter = `repo = "${sanitizeMeiliValue(repoFullName)}" AND branch = "${sanitizeMeiliValue(branch)}"`;
      void idx.deleteDocuments({ filter }).catch((err: unknown) => {
        logger.error({ err, githubUserId: row.github_user_id, repoFullName, branch }, "Failed to delete docs for deleted branch");
      });

      db.prepare("DELETE FROM repo_branch_index_state WHERE github_user_id=? AND repo_full_name=? AND branch=?")
        .run(row.github_user_id, repoFullName, branch);

      logger.info({ githubUserId: row.github_user_id, repoFullName, branch, pusher: senderLogin }, "Deleted branch webhook cleaned up docs and DB");
    }
    return;
  }

  const indexedRows = db.prepare(
    "SELECT github_user_id FROM repo_branch_index_state WHERE repo_full_name=? AND branch=? AND status='indexed'"
  ).all(repoFullName, branch) as { github_user_id: number }[];

  for (const row of indexedRows) {
    enqueueIndexBranch(db, {
      githubUserId: row.github_user_id,
      repoFullName,
      branch,
    });
    logger.info({ githubUserId: row.github_user_id, repoFullName, branch, pusher: senderLogin }, "Push webhook triggered reindex");
  }
}

function handleRepository(db: Db, body: Record<string, unknown>): void {
  const action = bodyStr(body, "action");
  if (action !== "deleted") return;

  const repoObj = bodyObj(body, "repository");
  const repoFullName = repoObj ? bodyStr(repoObj, "full_name") : "";
  if (!repoFullName) return;

  const rows = db.prepare(
    "SELECT DISTINCT github_user_id FROM repo_branch_index_state WHERE repo_full_name=?"
  ).all(repoFullName) as { github_user_id: number }[];

  for (const row of rows) {
    const safeRepo = sanitizeMeiliValue(repoFullName);
    void meili.index(indexNameForUser(row.github_user_id))
      .deleteDocuments({ filter: `repo = "${safeRepo}"` })
      .catch((err: unknown) => {
        logger.warn({ err, repoFullName, githubUserId: row.github_user_id }, "Failed to delete docs for deleted repo");
      });
  }

  db.prepare("DELETE FROM repo_branch_index_state WHERE repo_full_name=?").run(repoFullName);
  db.prepare("DELETE FROM repo_index_config WHERE repo_full_name=?").run(repoFullName);
  logger.info({ repoFullName }, "Repository deleted webhook: cleaned up index data");
}

function handleAppAuthRevoked(db: Db, body: Record<string, unknown>): void {
  const action = bodyStr(body, "action");
  if (action !== "revoked") return;

  const sender = bodyObj(body, "sender");
  const senderId = sender ? Number(sender.id ?? 0) : 0;
  if (!senderId) return;

  const user = db.prepare("SELECT github_user_id FROM users WHERE github_user_id=?").get(senderId) as { github_user_id: number } | undefined;
  if (!user) return;

  const idxName = indexNameForUser(senderId);
  void meili.deleteIndex(idxName).catch((_e: unknown) => undefined);
  clearIndexCache(senderId);

  db.prepare("DELETE FROM repo_branch_index_state WHERE github_user_id=?").run(senderId);
  db.prepare("DELETE FROM repo_index_config WHERE github_user_id=?").run(senderId);
  db.prepare("DELETE FROM invites WHERE github_user_id=?").run(senderId);
  db.prepare("DELETE FROM users WHERE github_user_id=?").run(senderId);

  logger.info({ githubUserId: senderId }, "GitHub App authorization revoked: cleaned up user data");
}
