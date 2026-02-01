import type { Db } from "./db.js";
import { decryptString, encryptString } from "./crypto.js";
import { logger } from "./logger.js";
import { refreshUserToken } from "./github.js";

interface UserTokenRow {
  access_token_enc: string;
  access_token_expires_at: number;
  refresh_token_enc: string;
  refresh_token_expires_at: number;
}

const refreshLocks = new Map<number, Promise<string>>();

export async function getValidAccessToken(db: Db, githubUserId: number): Promise<string> {
  const row = db.prepare(
    "SELECT access_token_enc, access_token_expires_at, refresh_token_enc, refresh_token_expires_at FROM users WHERE github_user_id=?"
  ).get(githubUserId) as UserTokenRow | undefined;

  if (!row) throw new Error("User not found");

  const now = Date.now();
  const skewMs = 5 * 60_000;

  if (row.access_token_expires_at > now + skewMs) {
    return decryptString(row.access_token_enc);
  }

  if (row.refresh_token_expires_at <= now) {
    throw new Error("Refresh token expired; re-auth required");
  }

  const existing = refreshLocks.get(githubUserId);
  if (existing) return existing;

  const promise = doRefresh(db, githubUserId, row).finally(() => {
    refreshLocks.delete(githubUserId);
  });
  refreshLocks.set(githubUserId, promise);
  return promise;
}

async function doRefresh(db: Db, githubUserId: number, row: UserTokenRow): Promise<string> {
  const currentRefresh = decryptString(row.refresh_token_enc);
  const newSet = await refreshUserToken(currentRefresh);

  db.prepare(
    `UPDATE users
     SET access_token_enc=@atok, access_token_expires_at=@aexp,
         refresh_token_enc=@rtok, refresh_token_expires_at=@rexp,
         token_updated_at=@ts
     WHERE github_user_id=@uid`
  ).run({
    atok: encryptString(newSet.accessToken),
    aexp: newSet.accessTokenExpiresAt,
    rtok: encryptString(newSet.refreshToken),
    rexp: newSet.refreshTokenExpiresAt,
    ts: Date.now(),
    uid: githubUserId,
  });

  logger.info({ githubUserId }, "Refreshed GitHub user token");
  return newSet.accessToken;
}
