import Database from "better-sqlite3";
import { logger } from "./logger.js";

export type Db = Database.Database;

export function openDb(filePath: string): Db {
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    logger.info({ filePath }, "SQLite DB opened");
    return db;
}

function migrate(db: Db): void {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      github_user_id INTEGER PRIMARY KEY,
      github_login TEXT NOT NULL,
      access_token_enc TEXT NOT NULL,
      access_token_expires_at INTEGER NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      refresh_token_expires_at INTEGER NOT NULL,
      token_updated_at INTEGER NOT NULL,
      etag_invites TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS invites (
      invite_id INTEGER PRIMARY KEY,
      github_user_id INTEGER NOT NULL,
      repository_full_name TEXT NOT NULL,
      inviter_login TEXT,
      created_at TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','unknown')),
      last_seen_at INTEGER NOT NULL,
      FOREIGN KEY (github_user_id) REFERENCES users(github_user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_invites_user_status ON invites (github_user_id, status);

    CREATE TABLE IF NOT EXISTS repo_index_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_user_id INTEGER NOT NULL,
      repo_full_name TEXT NOT NULL,
      branch_pattern TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(github_user_id, repo_full_name, branch_pattern),
      FOREIGN KEY (github_user_id) REFERENCES users(github_user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repo_branch_index_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_user_id INTEGER NOT NULL,
      repo_full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('indexed','indexing','failed')),
      last_error TEXT,
      UNIQUE(github_user_id, repo_full_name, branch),
      FOREIGN KEY (github_user_id) REFERENCES users(github_user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('index_branch')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);

    CREATE INDEX IF NOT EXISTS idx_rbi_repo_branch ON repo_branch_index_state (repo_full_name, branch);
  `);

    cleanupExpiredOauthStates(db);
}

function cleanupExpiredOauthStates(db: Db): void {
    db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(Date.now());
}

export function periodicCleanup(db: Db): void {
    cleanupExpiredOauthStates(db);
    db.prepare("DELETE FROM jobs WHERE status='done' AND updated_at < ?").run(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
