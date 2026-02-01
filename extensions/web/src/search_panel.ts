import { apiFetch } from "./http.js";
import type { IndexedBranch, SearchHit } from "./types.js";

const PANEL_ID = "gip_search_panel";
const PANEL_STYLE_ID = "gip_search_style";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function ensureSearchStyle(): void {
  if (document.getElementById(PANEL_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = PANEL_STYLE_ID;
  s.textContent = `
    #${PANEL_ID}{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:90vw;z-index:9999999;
      background:#fff;border-left:1px solid #d0d7de;box-shadow:-4px 0 16px rgba(0,0,0,.1);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden}
    .gsp-header{padding:12px 16px;border-bottom:1px solid #d0d7de;display:flex;align-items:center;justify-content:space-between}
    .gsp-header h3{margin:0;font-size:15px}
    .gsp-close{background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px;color:#656d76}
    .gsp-body{flex:1;overflow-y:auto;padding:12px 16px}
    .gsp-row{margin-bottom:10px}
    .gsp-label{font-size:12px;font-weight:600;margin-bottom:4px;color:#656d76}
    .gsp-select,.gsp-input{width:100%;padding:8px;border:1px solid #d0d7de;border-radius:6px;font-size:13px;box-sizing:border-box}
    .gsp-select:focus,.gsp-input:focus{outline:none;border-color:#0969da;box-shadow:0 0 0 3px rgba(9,105,218,.2)}
    .gsp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
    .gsp-chip{font-size:11px;padding:2px 8px;border-radius:12px;background:#ddf4ff;color:#0969da;cursor:pointer;border:1px solid transparent}
    .gsp-chip.active{background:#0969da;color:#fff}
    .gsp-results{margin-top:12px}
    .gsp-hit{padding:8px;border:1px solid #d0d7de;border-radius:6px;margin-bottom:6px;cursor:pointer;transition:background .1s}
    .gsp-hit:hover{background:#f6f8fa}
    .gsp-hit-path{font-size:13px;font-weight:600;color:#0969da}
    .gsp-hit-meta{font-size:11px;color:#656d76;margin-top:2px}
    .gsp-hit-snippet{font-size:12px;margin-top:4px;padding:6px 8px;background:#f6f8fa;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:100px;overflow-y:auto}
    .gsp-hit-snippet mark{background:#fff8c5;font-weight:600}
    .gsp-empty{text-align:center;color:#656d76;padding:32px 0;font-size:13px}
    .gsp-loading{text-align:center;color:#656d76;padding:16px 0;font-size:13px}
    .gsp-stats{font-size:11px;color:#656d76;margin-bottom:8px}
  `;
  document.head.appendChild(s);
}

type PanelState = {
  branches: IndexedBranch[];
  selectedRepo: string;
  selectedBranches: Set<string>;
  query: string;
  hits: SearchHit[];
  loading: boolean;
  stats: string;
};

let state: PanelState = {
  branches: [],
  selectedRepo: "",
  selectedBranches: new Set(),
  query: "",
  hits: [],
  loading: false,
  stats: "",
};

function getRepos(): string[] {
  const repos = new Set<string>();
  for (const b of state.branches) {
    if (b.status === "indexed") repos.add(b.repo_full_name);
  }
  return [...repos].sort();
}

function getBranchesForRepo(repo: string): string[] {
  return state.branches
    .filter(b => b.repo_full_name === repo && b.status === "indexed")
    .map(b => b.branch)
    .sort();
}

async function loadBranches(): Promise<void> {
  try {
    const r = await apiFetch("/api/branches", { method: "GET" });
    if (!r.ok) return;
    const j = await r.json() as { branches: IndexedBranch[] };
    state.branches = j.branches ?? [];
  } catch {}
}

async function doSearch(): Promise<void> {
  if (!state.selectedRepo || !state.query.trim()) {
    state.hits = [];
    state.stats = "";
    renderPanel();
    return;
  }

  state.loading = true;
  renderPanel();

  try {
    const branchParam = [...state.selectedBranches].join(",");
    const params = new URLSearchParams({
      repo: state.selectedRepo,
      q: state.query.trim(),
      branches: branchParam,
    });
    const r = await apiFetch(`/api/search?${params.toString()}`, { method: "GET" });
    if (!r.ok) {
      state.hits = [];
      state.stats = "Search failed";
      return;
    }
    const j = await r.json() as { hits: SearchHit[]; processingTimeMs: number; estimatedTotalHits: number };
    state.hits = j.hits ?? [];
    state.stats = `${j.estimatedTotalHits ?? 0} results in ${j.processingTimeMs}ms`;
  } catch {
    state.hits = [];
    state.stats = "Search failed";
  } finally {
    state.loading = false;
    renderPanel();
  }
}

function scheduleSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void doSearch(), 300);
}

function renderPanel(): void {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const body = panel.querySelector(".gsp-body") as HTMLElement;
  if (!body) return;
  body.replaceChildren();

  const repoRow = document.createElement("div");
  repoRow.className = "gsp-row";
  const repoLabel = document.createElement("div");
  repoLabel.className = "gsp-label";
  repoLabel.textContent = "REPOSITORY";
  const repoSelect = document.createElement("select");
  repoSelect.className = "gsp-select";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Select a repository...";
  repoSelect.appendChild(defaultOpt);

  for (const repo of getRepos()) {
    const opt = document.createElement("option");
    opt.value = repo;
    opt.textContent = repo;
    if (repo === state.selectedRepo) opt.selected = true;
    repoSelect.appendChild(opt);
  }

  repoSelect.onchange = () => {
    state.selectedRepo = repoSelect.value;
    state.selectedBranches = new Set(getBranchesForRepo(state.selectedRepo));
    state.hits = [];
    state.stats = "";
    renderPanel();
    if (state.query.trim()) scheduleSearch();
  };

  repoRow.append(repoLabel, repoSelect);
  body.appendChild(repoRow);

  if (state.selectedRepo) {
    const branchRow = document.createElement("div");
    branchRow.className = "gsp-row";
    const branchLabel = document.createElement("div");
    branchLabel.className = "gsp-label";
    branchLabel.textContent = "BRANCHES";
    const chips = document.createElement("div");
    chips.className = "gsp-chips";

    for (const b of getBranchesForRepo(state.selectedRepo)) {
      const chip = document.createElement("span");
      chip.className = "gsp-chip" + (state.selectedBranches.has(b) ? " active" : "");
      chip.textContent = b;
      chip.onclick = () => {
        if (state.selectedBranches.has(b)) {
          state.selectedBranches.delete(b);
        } else {
          state.selectedBranches.add(b);
        }
        renderPanel();
        if (state.query.trim()) scheduleSearch();
      };
      chips.appendChild(chip);
    }

    branchRow.append(branchLabel, chips);
    body.appendChild(branchRow);
  }

  const queryRow = document.createElement("div");
  queryRow.className = "gsp-row";
  const queryLabel = document.createElement("div");
  queryLabel.className = "gsp-label";
  queryLabel.textContent = "SEARCH";
  const queryInput = document.createElement("input");
  queryInput.className = "gsp-input";
  queryInput.type = "text";
  queryInput.placeholder = "Search code...";
  queryInput.value = state.query;
  queryInput.oninput = () => {
    state.query = queryInput.value;
    scheduleSearch();
  };
  queryRow.append(queryLabel, queryInput);
  body.appendChild(queryRow);

  const results = document.createElement("div");
  results.className = "gsp-results";

  if (state.loading) {
    const loading = document.createElement("div");
    loading.className = "gsp-loading";
    loading.textContent = "Searching...";
    results.appendChild(loading);
  } else if (state.stats) {
    const statsEl = document.createElement("div");
    statsEl.className = "gsp-stats";
    statsEl.textContent = state.stats;
    results.appendChild(statsEl);

    if (state.hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gsp-empty";
      empty.textContent = "No results found";
      results.appendChild(empty);
    } else {
      for (const hit of state.hits) {
        const hitEl = document.createElement("div");
        hitEl.className = "gsp-hit";
        hitEl.onclick = () => {
          const safeRepo = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(hit.repo) ? hit.repo : "";
          const safeBranch = /^[a-zA-Z0-9._\-/]+$/.test(hit.branch) ? hit.branch : "";
          if (!safeRepo || !safeBranch) return;
          const url = new URL(`/${safeRepo}/blob/${safeBranch}/${hit.path}`, "https://github.com");
          if (url.hostname !== "github.com") return;
          window.open(url.toString(), "_blank");
        };

        const pathEl = document.createElement("div");
        pathEl.className = "gsp-hit-path";
        pathEl.textContent = hit.path;

        const metaEl = document.createElement("div");
        metaEl.className = "gsp-hit-meta";
        metaEl.textContent = `${hit.repo} @ ${hit.branch}`;

        hitEl.append(pathEl, metaEl);

        if (hit._formatted?.content) {
          const snippet = document.createElement("div");
          snippet.className = "gsp-hit-snippet";
          const raw = hit._formatted.content;
          const lines = raw.split("\n").slice(0, 8).join("\n");
          renderHighlighted(snippet, lines);
          hitEl.appendChild(snippet);
        }

        results.appendChild(hitEl);
      }
    }
  } else if (!state.selectedRepo) {
    const empty = document.createElement("div");
    empty.className = "gsp-empty";
    empty.textContent = "Select a repository to begin searching";
    results.appendChild(empty);
  }

  body.appendChild(results);

  requestAnimationFrame(() => {
    if (!state.query && queryInput) queryInput.focus();
  });
}

function renderHighlighted(container: HTMLElement, text: string): void {
  const parts = text.split(/(<mark>|<\/mark>)/);
  let inMark = false;
  for (const part of parts) {
    if (part === "<mark>") { inMark = true; continue; }
    if (part === "</mark>") { inMark = false; continue; }
    if (inMark) {
      const mark = document.createElement("mark");
      mark.textContent = part;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  }
}

export function openSearchPanel(): void {
  ensureSearchStyle();

  if (document.getElementById(PANEL_ID)) {
    closeSearchPanel();
    return;
  }

  state = {
    branches: [],
    selectedRepo: "",
    selectedBranches: new Set(),
    query: "",
    hits: [],
    loading: false,
    stats: "",
  };

  const panel = document.createElement("div");
  panel.id = PANEL_ID;

  const header = document.createElement("div");
  header.className = "gsp-header";
  const title = document.createElement("h3");
  title.textContent = "Branch Code Search";
  const closeBtn = document.createElement("button");
  closeBtn.className = "gsp-close";
  closeBtn.textContent = "\u00d7";
  closeBtn.onclick = closeSearchPanel;
  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "gsp-body";

  const loadingMsg = document.createElement("div");
  loadingMsg.className = "gsp-loading";
  loadingMsg.textContent = "Loading indexed branches...";
  body.appendChild(loadingMsg);

  panel.append(header, body);
  document.body.appendChild(panel);

  void loadBranches().then(() => {
    renderPanel();
  });
}

export function closeSearchPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
  if (debounceTimer) clearTimeout(debounceTimer);
}
