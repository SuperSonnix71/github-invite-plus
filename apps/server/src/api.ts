import { Router, type Request, type Response, type NextFunction } from "express";
import type { Db } from "./db.js";
import { requireAuth, requireCsrf } from "./middleware.js";
import { listInvites, refreshInvites, acceptInvite, declineInvite } from "./invites.js";
import { enqueueIndexBranch } from "./jobs.js";
import { meili, indexNameForUser, ensureIndexCached } from "./meili.js";
import { isValidRepo, isValidBranch, sanitizeMeiliValue } from "./validate.js";

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function sessionUser(req: Request) {
  const u = req.session.user;
  if (!u) throw new Error("No session user");
  return u;
}

function queryStr(v: Request["query"][string]): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

interface BranchRow {
  repo_full_name: string;
  branch: string;
  status: string;
  indexed_at: number;
}

export function createApiRouter(db: Db): Router {
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  r.get("/me", requireAuth, (req, res) => {
    const u = sessionUser(req);
    res.json({
      ok: true,
      githubUserId: u.githubUserId,
      githubLogin: u.githubLogin,
      csrfToken: u.csrfToken,
    });
  });

  r.post("/invites/refresh", requireAuth, asyncHandler(async (req, res) => {
    const u = sessionUser(req);
    const out = await refreshInvites(db, u.githubUserId);
    res.json({ ok: true, ...out });
  }));

  r.get("/invites", requireAuth, (req, res) => {
    const u = sessionUser(req);
    const statusFilter = queryStr(req.query.status) || "pending";
    const limit = Math.max(1, Number(queryStr(req.query.limit)) || 100);
    const offset = Math.max(0, Number(queryStr(req.query.offset)) || 0);
    res.json({ ok: true, invites: listInvites(db, u.githubUserId, statusFilter, limit, offset) });
  });

  r.post("/invites/:id/accept", requireCsrf, asyncHandler(async (req, res) => {
    const u = sessionUser(req);
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ ok: false, error: "Invalid invite id" });
      return;
    }
    const row = db.prepare("SELECT invite_id FROM invites WHERE invite_id=? AND github_user_id=?").get(inviteId, u.githubUserId) as { invite_id: number } | undefined;
    if (!row) {
      res.status(404).json({ ok: false, error: "Invite not found" });
      return;
    }
    await acceptInvite(db, u.githubUserId, inviteId);
    res.json({ ok: true });
  }));

  r.post("/invites/:id/decline", requireCsrf, asyncHandler(async (req, res) => {
    const u = sessionUser(req);
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ ok: false, error: "Invalid invite id" });
      return;
    }
    const row = db.prepare("SELECT invite_id FROM invites WHERE invite_id=? AND github_user_id=?").get(inviteId, u.githubUserId) as { invite_id: number } | undefined;
    if (!row) {
      res.status(404).json({ ok: false, error: "Invite not found" });
      return;
    }
    await declineInvite(db, u.githubUserId, inviteId);
    res.json({ ok: true });
  }));

  r.post("/index/branch", requireCsrf, (req, res) => {
    const u = sessionUser(req);
    const body = req.body as Record<string, unknown> | null;
    const repoFullName = typeof body?.repoFullName === "string" ? body.repoFullName : "";
    const branch = typeof body?.branch === "string" ? body.branch : "";
    if (!isValidRepo(repoFullName) || !isValidBranch(branch)) {
      res.status(400).json({ ok: false, error: "Invalid repo or branch name" });
      return;
    }
    const jobId = enqueueIndexBranch(db, { githubUserId: u.githubUserId, repoFullName, branch });
    res.json({ ok: true, jobId });
  });

  r.get("/branches", requireAuth, (req, res) => {
    const u = sessionUser(req);
    const limit = Math.min(Math.max(1, Number(queryStr(req.query.limit)) || 200), 500);
    const offset = Math.max(0, Number(queryStr(req.query.offset)) || 0);
    const rows = db.prepare(
      "SELECT repo_full_name, branch, status, indexed_at FROM repo_branch_index_state WHERE github_user_id=? ORDER BY repo_full_name, branch LIMIT ? OFFSET ?"
    ).all(u.githubUserId, limit, offset) as BranchRow[];
    res.json({ ok: true, branches: rows });
  });

  r.get("/search", requireAuth, asyncHandler(async (req, res) => {
    const u = sessionUser(req);
    const repo = queryStr(req.query.repo);
    const q = queryStr(req.query.q);
    const branchesRaw = queryStr(req.query.branches);
    if (!isValidRepo(repo) || !q) {
      res.status(400).json({ ok: false, error: "Invalid repo or empty query" });
      return;
    }

    await ensureIndexCached(u.githubUserId);
    const idx = meili.index(indexNameForUser(u.githubUserId));

    const safeRepo = sanitizeMeiliValue(repo);
    const branches = branchesRaw.split(",").map(s => s.trim()).filter(Boolean);

    for (const b of branches) {
      if (!isValidBranch(b)) {
        res.status(400).json({ ok: false, error: "Invalid branch name" });
        return;
      }
    }

    const filters: string[] = [`repo = "${safeRepo}"`];
    if (branches.length === 1) {
      const first = branches[0];
      if (first) filters.push(`branch = "${sanitizeMeiliValue(first)}"`);
    } else if (branches.length > 1) {
      filters.push(`branch IN [${branches.map(b => `"${sanitizeMeiliValue(b)}"`).join(",")}]`);
    }

    const search = await idx.search(q, {
      filter: filters.join(" AND "),
      attributesToRetrieve: ["repo", "branch", "path"],
      attributesToHighlight: ["content"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
      limit: 50,
    });

    res.json({ ok: true, hits: search.hits, processingTimeMs: search.processingTimeMs, estimatedTotalHits: search.estimatedTotalHits });
  }));

  r.get("/search/url", requireAuth, (req, res) => {
    const repo = queryStr(req.query.repo);
    const q = queryStr(req.query.q);
    const branch = queryStr(req.query.branch);
    if (!isValidRepo(repo) || !q) {
      res.status(400).json({ ok: false, error: "Invalid repo or empty query" });
      return;
    }

    const base = "https://github.com/search";
    const params = new URLSearchParams();
    params.set("q", `repo:${repo} ${q}`.trim());
    params.set("type", "code");
    if (branch && isValidBranch(branch)) params.set("ref", branch);

    res.json({ ok: true, url: `${base}?${params.toString()}` });
  });

  return r;
}
