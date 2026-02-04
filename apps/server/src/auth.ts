import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import crypto from "crypto";
import type { Db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { encryptString } from "./crypto.js";
import { exchangeCodeForUserToken, getAuthenticatedUser } from "./github.js";
import { asyncHandler } from "./middleware.js";
import { requireCsrf } from "./middleware.js";
import { cookieSecure } from "./env.js";

function jsonError(res: Response, status: number, msg: string) {
  res.status(status).json({ ok: false, error: msg });
}

function originFingerprint(req: Request): string {
  const origin = req.headers.origin ?? "";
  const ua = req.headers["user-agent"] ?? "";
  return crypto.createHash("sha256").update(`${origin}|${ua}`).digest("hex").slice(0, 16);
}

export function createAuthRouter(db: Db): Router {
  const r = Router();

  const ALLOWED_REDIRECT_URIS = new Set([
    env.EXTENSION_REDIRECT_URI,
  ]);

  r.post("/start", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri : "";
      if (!ALLOWED_REDIRECT_URIS.has(redirectUri)) {
        jsonError(res, 400, "Invalid redirectUri");
        return;
      }

      const state = nanoid(32);
      const ts = Date.now();
      const expiresAt = ts + 10 * 60_000;
      const fingerprint = originFingerprint(req);

      db.prepare("INSERT INTO oauth_states(state, created_at, expires_at, fingerprint, redirect_uri) VALUES(?,?,?,?,?)").run(state, ts, expiresAt, fingerprint, redirectUri);

      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);

      res.json({ ok: true, authorizeUrl: url.toString(), state, expiresAt });
    } catch (err: unknown) {
      logger.error({ err }, "POST /auth/start failed");
      jsonError(res, 500, "Auth start failed");
    }
  });

  r.post("/exchange", asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const state = typeof body?.state === "string" ? body.state : "";
    const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri : "";
    if (!code || !state || !redirectUri) {
      jsonError(res, 400, "Missing code/state/redirectUri");
      return;
    }

    const fingerprint = originFingerprint(req);
    const st = db.prepare("SELECT state, expires_at, fingerprint, redirect_uri FROM oauth_states WHERE state=?").get(state) as { state: string; expires_at: number; fingerprint: string; redirect_uri: string } | undefined;
    if (!st || st.expires_at < Date.now()) {
      jsonError(res, 400, "Invalid or expired state");
      return;
    }
    if (st.fingerprint !== fingerprint) {
      db.prepare("DELETE FROM oauth_states WHERE state=?").run(state);
      jsonError(res, 400, "State origin mismatch");
      return;
    }
    if (st.redirect_uri !== redirectUri) {
      db.prepare("DELETE FROM oauth_states WHERE state=?").run(state);
      jsonError(res, 400, "Redirect URI mismatch");
      return;
    }
    db.prepare("DELETE FROM oauth_states WHERE state=?").run(state);

    const tokenSet = await exchangeCodeForUserToken(code, redirectUri);
    const me = await getAuthenticatedUser(tokenSet.accessToken);

    const csrfToken = nanoid(32);

    db.prepare(
      `INSERT INTO users(github_user_id, github_login, access_token_enc, access_token_expires_at, refresh_token_enc, refresh_token_expires_at, token_updated_at)
       VALUES (@id,@login,@atok,@aexp,@rtok,@rexp,@ts)
       ON CONFLICT(github_user_id) DO UPDATE SET
         github_login=excluded.github_login,
         access_token_enc=excluded.access_token_enc,
         access_token_expires_at=excluded.access_token_expires_at,
         refresh_token_enc=excluded.refresh_token_enc,
         refresh_token_expires_at=excluded.refresh_token_expires_at,
         token_updated_at=excluded.token_updated_at`
    ).run({
      id: me.id,
      login: me.login,
      atok: encryptString(tokenSet.accessToken),
      aexp: tokenSet.accessTokenExpiresAt,
      rtok: encryptString(tokenSet.refreshToken),
      rexp: tokenSet.refreshTokenExpiresAt,
      ts: Date.now(),
    });

    req.session.user = { githubUserId: me.id, githubLogin: me.login, csrfToken };
    req.session.save((err: unknown) => {
      if (err) {
        logger.error({ err }, "Failed to save session");
        jsonError(res, 500, "Session save failed");
        return;
      }
      res.json({ ok: true, csrfToken });
    });
  }));

  r.post("/logout", requireCsrf, asyncHandler(async (req: Request, res: Response) => {
    const cookieName = cookieSecure() ? "__Host-gip_sid" : "gip_sid";
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err: unknown) => {
        if (err) {
          const errMsg = err instanceof Error ? err.message : (typeof err === "string" ? err : "Unknown error");
          reject(new Error(errMsg));
        } else {
          resolve();
        }
      });
    });
    res.clearCookie(cookieName);
    res.json({ ok: true });
  }));

  return r;
}
