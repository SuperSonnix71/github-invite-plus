import type { Db } from "./db.js";
import { getValidAccessToken } from "./tokens.js";
import { listRepoInvites, acceptRepoInvite, declineRepoInvite } from "./github.js";

export interface InviteRow {
  invite_id: number;
  repository_full_name: string;
  inviter_login: string | null;
  created_at: string;
  status: "pending" | "accepted" | "declined" | "unknown";
}

const VALID_STATUSES = new Set(["pending", "accepted", "declined", "unknown", "all"]);
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

export function listInvites(db: Db, githubUserId: number, statusFilter = "pending", limit = DEFAULT_PAGE_SIZE, offset = 0): InviteRow[] {
  if (!VALID_STATUSES.has(statusFilter)) statusFilter = "pending";
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
  const safeOffset = Math.max(0, offset);
  if (statusFilter === "all") {
    return db.prepare(
      "SELECT invite_id, repository_full_name, inviter_login, created_at, status FROM invites WHERE github_user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(githubUserId, safeLimit, safeOffset) as InviteRow[];
  }
  return db.prepare(
    "SELECT invite_id, repository_full_name, inviter_login, created_at, status FROM invites WHERE github_user_id=? AND status=? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(githubUserId, statusFilter, safeLimit, safeOffset) as InviteRow[];
}

export async function refreshInvites(db: Db, githubUserId: number): Promise<{ pendingCount: number }> {
  const token = await getValidAccessToken(db, githubUserId);

  const etagRow = db.prepare("SELECT etag_invites FROM users WHERE github_user_id=?").get(githubUserId) as { etag_invites?: string | null } | undefined;
  const etag = etagRow?.etag_invites ?? null;

  const res = await listRepoInvites(token, etag);

  if (res.notModified) {
    const cnt = db.prepare("SELECT COUNT(*) as c FROM invites WHERE github_user_id=? AND status='pending'").get(githubUserId) as { c: number } | undefined;
    return { pendingCount: cnt?.c ?? 0 };
  }

  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO invites(invite_id, github_user_id, repository_full_name, inviter_login, created_at, updated_at, status, last_seen_at)
     VALUES (?,?,?,?,?,?,'pending',?)
     ON CONFLICT(invite_id) DO UPDATE SET
       repository_full_name=excluded.repository_full_name,
       inviter_login=excluded.inviter_login,
       updated_at=excluded.updated_at,
       status=excluded.status,
       last_seen_at=excluded.last_seen_at`
  );

  const tx = db.transaction(() => {
    for (const i of res.invites) {
      upsert.run(i.id, githubUserId, i.repositoryFullName, i.inviterLogin, i.createdAt, now, now);
    }

    if (res.invites.length > 0) {
      const placeholders = res.invites.map(() => "?").join(",");
      db.prepare(
        `UPDATE invites SET status='unknown', updated_at=?
         WHERE github_user_id=? AND status='pending'
         AND invite_id NOT IN (${placeholders})`
      ).run(now, githubUserId, ...res.invites.map(x => x.id));
    } else {
      db.prepare(
        "UPDATE invites SET status='unknown', updated_at=? WHERE github_user_id=? AND status='pending'"
      ).run(now, githubUserId);
    }

    db.prepare("UPDATE users SET etag_invites=? WHERE github_user_id=?").run(res.etag, githubUserId);
  });

  tx();

  return { pendingCount: res.invites.length };
}

export async function acceptInvite(db: Db, githubUserId: number, inviteId: number): Promise<void> {
  const token = await getValidAccessToken(db, githubUserId);
  await acceptRepoInvite(token, inviteId);
  db.prepare("UPDATE invites SET status='accepted', updated_at=? WHERE github_user_id=? AND invite_id=?")
    .run(Date.now(), githubUserId, inviteId);
}

export async function declineInvite(db: Db, githubUserId: number, inviteId: number): Promise<void> {
  const token = await getValidAccessToken(db, githubUserId);
  await declineRepoInvite(token, inviteId);
  db.prepare("UPDATE invites SET status='declined', updated_at=? WHERE github_user_id=? AND invite_id=?")
    .run(Date.now(), githubUserId, inviteId);
}
