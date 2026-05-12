/**
 * Pure-JS read-only git inspector.
 *
 * Reads the on-disk format directly via the host bridge — no `git`
 * subprocess. Format references:
 *   - HEAD:                   plain text, "ref: refs/heads/<branch>\n"
 *                             OR a 40-char hex sha (detached).
 *   - refs/heads/<branch>:    40-char hex sha + newline.
 *   - logs/HEAD:              one line per move:
 *                             "<old> <new> <name <email>> <unix> <tz>\t<msg>"
 *
 * Everything is best-effort; on any read error we surface a friendly
 * message rather than throwing — the user might just be outside a repo.
 */

import { host } from "./host-bridge";

export interface CommitEntry {
  shortSha: string;
  fullSha: string;
  author: string;
  whenIso: string;
  message: string;
}

export interface GitState {
  insideRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  /** True when HEAD is a detached commit (not on a branch). */
  detached: boolean;
  /** Short sha of the current HEAD commit, or null if unreadable. */
  headSha: string | null;
  /** Last N commits, newest first. Empty when reflog is unreadable. */
  recentCommits: CommitEntry[];
  /** Worktree summary derived from .git mtimes — coarse, not file-level. */
  lastFetchAgo: string | null;
  lastCommitAgo: string | null;
  error: string | null;
}

const empty: GitState = {
  insideRepo: false,
  repoRoot: null,
  branch: null,
  detached: false,
  headSha: null,
  recentCommits: [],
  lastFetchAgo: null,
  lastCommitAgo: null,
  error: null,
};

/**
 * Locate the .git directory by walking upwards from the workspace root
 * one level. We don't recurse — most workspaces have .git at the top.
 */
async function locateGitDir(): Promise<string | null> {
  try {
    const entries = await host.list(".");
    if (entries.some((e) => e.name === ".git" && e.kind === "dir")) {
      return ".git";
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export async function readGitState(): Promise<GitState> {
  const state: GitState = { ...empty, recentCommits: [] };

  let root: string;
  try {
    root = await host.workspaceRoot();
    state.repoRoot = root;
  } catch (err) {
    state.error = (err as Error).message;
    return state;
  }

  const gitDir = await locateGitDir();
  if (!gitDir) {
    state.error = "no .git directory found in this workspace";
    return state;
  }
  state.insideRepo = true;

  // ── HEAD ────────────────────────────────────────────────────────────
  let headRefPath: string | null = null;
  try {
    const head = (await host.readText(`${gitDir}/HEAD`)).trim();
    const m = /^ref:\s*(refs\/heads\/.+)$/.exec(head);
    if (m) {
      state.branch = m[1].replace(/^refs\/heads\//, "");
      headRefPath = `${gitDir}/${m[1]}`;
    } else if (/^[0-9a-f]{40}$/i.test(head)) {
      state.detached = true;
      state.headSha = head.slice(0, 7);
    }
  } catch (err) {
    state.error = `failed to read HEAD: ${(err as Error).message}`;
    return state;
  }

  // ── current commit sha (if on a branch) ─────────────────────────────
  if (headRefPath && !state.headSha) {
    try {
      const sha = (await host.readText(headRefPath)).trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) state.headSha = sha.slice(0, 7);
    } catch {
      // packed-refs fallback — try once
      try {
        const packed = await host.readText(`${gitDir}/packed-refs`);
        const ref = `refs/heads/${state.branch}`;
        for (const line of packed.split("\n")) {
          if (line.endsWith(` ${ref}`)) {
            state.headSha = line.slice(0, 7);
            break;
          }
        }
      } catch {
        /* the branch may have no commits yet */
      }
    }
  }

  // ── recent commits from reflog ──────────────────────────────────────
  try {
    const log = await host.readText(`${gitDir}/logs/HEAD`);
    const lines = log.split("\n").filter(Boolean);
    const tail = lines.slice(-5).reverse();
    state.recentCommits = tail
      .map(parseReflogLine)
      .filter((x): x is CommitEntry => x !== null);
    if (state.recentCommits[0]) {
      state.lastCommitAgo = state.recentCommits[0].whenIso;
    }
  } catch {
    /* reflog may be empty on a fresh repo */
  }

  // ── last fetch (FETCH_HEAD mtime) ───────────────────────────────────
  try {
    const s = await host.stat(`${gitDir}/FETCH_HEAD`);
    state.lastFetchAgo = new Date(s.mtimeMs).toISOString();
  } catch {
    /* never fetched */
  }

  return state;
}

/**
 * Reflog line shape:
 *   <old_sha> <new_sha> <author_name> <author_email> <unix_ts> <tz>\t<msg>
 *
 * Author can contain spaces, so we anchor on the timestamp + tab message
 * separator instead of splitting on spaces blindly.
 */
function parseReflogLine(line: string): CommitEntry | null {
  const tabIdx = line.indexOf("\t");
  if (tabIdx === -1) return null;
  const left = line.slice(0, tabIdx);
  const message = line.slice(tabIdx + 1);

  // Match: <old> <new> <author...> <unix> <tz>
  // The last two whitespace-separated tokens are unix + tz.
  const tokens = left.split(/\s+/);
  if (tokens.length < 5) return null;
  const [oldSha, newSha, ...rest] = tokens;
  const tz = rest.pop()!;
  const unix = rest.pop()!;
  const author = rest.join(" ");

  if (!/^[0-9a-f]{40}$/i.test(newSha)) return null;
  const tsMs = Number.parseInt(unix, 10) * 1000;
  if (!Number.isFinite(tsMs)) return null;

  // Strip the operation prefix from the message if present
  // (e.g. "commit: real-message", "pull: Fast-forward").
  const cleanMessage = message.replace(/^[^:]+:\s*/, "");

  // Use the first 7 chars of new sha (or old sha when newSha is all-zero
  // sentinel for the very first commit).
  const sha = /^0+$/.test(newSha) ? oldSha : newSha;

  void tz; // tz kept for future use (display in commit author timezone)

  return {
    shortSha: sha.slice(0, 7),
    fullSha: sha,
    author,
    whenIso: new Date(tsMs).toISOString(),
    message: cleanMessage,
  };
}
