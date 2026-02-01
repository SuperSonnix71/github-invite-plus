import session from "express-session";
import type { Db } from "./db.js";
import { env, cookieSameSite, cookieSecure } from "./env.js";
import { logger } from "./logger.js";
import createSqliteStore from "better-sqlite3-session-store";

const SqliteStore = createSqliteStore(session);

export interface SessionUser {
  githubUserId: number;
  githubLogin: string;
  csrfToken: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export function createSessionMiddleware(db: Db) {
  const store = new SqliteStore({
    client: db as unknown,
    expired: { clear: true, intervalMs: 60_000 },
  });

  const sameSite = cookieSameSite();
  const secure = cookieSecure();

  logger.info({ sameSite, secure }, "Session cookie config");

  return session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: "__Host-gip_sid",
    cookie: {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 14 * 24 * 60 * 60 * 1000,
      path: "/",
    },
    store,
  });
}
