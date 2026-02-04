import { Octokit } from "@octokit/rest";
import { env } from "./env.js";
import { logger } from "./logger.js";

const FETCH_TIMEOUT_MS = 30_000;

interface TokenSet {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
}
export type { TokenSet };

export function createUserOctokit(accessToken: string): Octokit {
    return new Octokit({
        auth: accessToken,
        userAgent: "github-invite-plus/2.0",
        request: { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    });
}

function tokenDataString(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function tokenDataNumber(v: unknown, fallback: number): number {
    return typeof v === "number" ? v : fallback;
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string): Promise<TokenSet> {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: env.GITHUB_APP_CLIENT_ID,
            client_secret: env.GITHUB_APP_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const data = await tokenRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!tokenRes.ok || !data.access_token) {
        logger.warn({ status: tokenRes.status, error: data.error, errorDesc: data.error_description }, "GitHub token exchange failed");
        throw new Error(typeof data.error_description === "string" ? data.error_description : "GitHub token exchange failed");
    }

    const now = Date.now();
    const expiresInSec = tokenDataNumber(data.expires_in, 28800);
    const refreshExpiresInSec = tokenDataNumber(data.refresh_token_expires_in, 15897600);

    return {
        accessToken: tokenDataString(data.access_token),
        accessTokenExpiresAt: now + expiresInSec * 1000,
        refreshToken: tokenDataString(data.refresh_token),
        refreshTokenExpiresAt: now + refreshExpiresInSec * 1000,
    };
}

export async function refreshUserToken(refreshToken: string): Promise<TokenSet> {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: env.GITHUB_APP_CLIENT_ID,
            client_secret: env.GITHUB_APP_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const data = await tokenRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!tokenRes.ok || !data.access_token) {
        logger.warn({ status: tokenRes.status, error: data.error, errorDesc: data.error_description }, "GitHub token refresh failed");
        const desc = typeof data.error_description === "string" ? data.error_description
            : typeof data.error === "string" ? data.error
                : "GitHub token refresh failed";
        throw new Error(desc);
    }

    const now = Date.now();
    const expiresInSec = tokenDataNumber(data.expires_in, 28800);
    const refreshExpiresInSec = tokenDataNumber(data.refresh_token_expires_in, 15897600);

    return {
        accessToken: tokenDataString(data.access_token),
        accessTokenExpiresAt: now + expiresInSec * 1000,
        refreshToken: tokenDataString(data.refresh_token),
        refreshTokenExpiresAt: now + refreshExpiresInSec * 1000,
    };
}

export async function getAuthenticatedUser(accessToken: string): Promise<{ id: number; login: string }> {
    const octokit = createUserOctokit(accessToken);
    const me = await octokit.rest.users.getAuthenticated();
    if (!me.data.id || !me.data.login) {
        throw new Error("Missing GitHub identity");
    }
    return { id: me.data.id, login: me.data.login };
}

interface RepoInvite {
    id: number;
    repositoryFullName: string;
    inviterLogin: string | null;
    createdAt: string;
}
export type { RepoInvite };

export async function listRepoInvites(accessToken: string, etag?: string | null): Promise<{ invites: RepoInvite[]; etag: string | null; notModified: boolean }> {
    const octokit = createUserOctokit(accessToken);

    try {
        const allInvites: { id: number; repository: { full_name: string }; inviter?: { login: string } | null; created_at: string }[] = [];
        let responseEtag: string | null = null;

        const requestOptions: {per_page: number; headers?: Record<string, string>} = {
            per_page: 100,
        };
        if (etag) {
            requestOptions.headers = { "if-none-match": etag };
        }

        for await (const response of octokit.paginate.iterator("GET /user/repository_invitations", requestOptions)) {
            if (!responseEtag && response.headers.etag) {
                responseEtag = response.headers.etag;
            }
            allInvites.push(...response.data as { id: number; repository: { full_name: string }; inviter?: { login: string } | null; created_at: string }[]);
        }

        const invites = allInvites.map(i => ({
            id: i.id,
            repositoryFullName: i.repository.full_name,
            inviterLogin: i.inviter?.login ?? null,
            createdAt: i.created_at,
        }));

        return { invites, etag: responseEtag, notModified: false };
    } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 304) {
            return { invites: [], etag: etag ?? null, notModified: true };
        }
        throw err;
    }
}

export async function acceptRepoInvite(accessToken: string, invitationId: number): Promise<void> {
    const octokit = createUserOctokit(accessToken);
    await octokit.request("PATCH /user/repository_invitations/{invitation_id}", { invitation_id: invitationId });
}

export async function declineRepoInvite(accessToken: string, invitationId: number): Promise<void> {
    const octokit = createUserOctokit(accessToken);
    await octokit.request("DELETE /user/repository_invitations/{invitation_id}", { invitation_id: invitationId });
}

export async function getBranchHeadSha(accessToken: string, repoFullName: string, branch: string): Promise<string> {
    const [owner = "", repo = ""] = repoFullName.split("/");
    const octokit = createUserOctokit(accessToken);
    const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const sha = ref.data.object.sha;
    if (!sha) throw new Error("Missing branch sha");
    return sha;
}

interface TreeEntry {
    path: string;
    type: "blob" | "tree";
    sha: string;
    size?: number | null;
}
export type { TreeEntry };

export async function getRepoTreeRecursive(accessToken: string, repoFullName: string, treeSha: string): Promise<TreeEntry[]> {
    const [owner = "", repo = ""] = repoFullName.split("/");
    const octokit = createUserOctokit(accessToken);
    const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "1" });
    if (tree.data.truncated) {
        throw new Error("Repository tree is truncated, cannot index completely");
    }
    return tree.data.tree.filter(e => e.path && e.type && e.sha).map(e => ({
        path: String(e.path),
        type: e.type === "blob" ? ("blob" as const) : ("tree" as const),
        sha: String(e.sha),
        size: (e as { size?: number }).size ?? null,
    }));
}

export async function getBlobText(accessToken: string, repoFullName: string, blobSha: string): Promise<{ text: string; bytes: number }> {
    const [owner = "", repo = ""] = repoFullName.split("/");
    const octokit = createUserOctokit(accessToken);
    const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: blobSha });
    const encoding = blob.data.encoding;
    const content = blob.data.content;
    if (encoding !== "base64" || !content) {
        throw new Error("Unsupported blob encoding");
    }
    const buf = Buffer.from(content, "base64");
    const nulls = buf.subarray(0, Math.min(buf.length, 2048)).filter(b => b === 0).length;
    if (nulls > 0) throw new Error("Binary blob");
    return { text: buf.toString("utf8"), bytes: buf.length };
}
