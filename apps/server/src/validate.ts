const REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const BRANCH_RE = /^[a-zA-Z0-9._\-/]+$/;

export function isValidRepo(v: string): boolean {
  return REPO_RE.test(v) && v.length <= 200;
}

export function isValidBranch(v: string): boolean {
  return BRANCH_RE.test(v) && v.length <= 256 && !v.includes("..");
}

export function sanitizeMeiliValue(v: string): string {
  return v.replace(/[\\"]/g, "");
}
