export type Invite = {
  invite_id: number;
  repository_full_name: string;
  inviter_login: string | null;
  created_at: string;
  status: "pending" | "accepted" | "declined" | "unknown";
};

export type ApiMe = {
  ok: boolean;
  githubUserId: number;
  githubLogin: string;
  csrfToken: string;
};

export type IndexedBranch = {
  repo_full_name: string;
  branch: string;
  status: string;
  indexed_at: number;
};

export type SearchHit = {
  repo: string;
  branch: string;
  path: string;
  _formatted?: {
    content?: string;
  };
};
