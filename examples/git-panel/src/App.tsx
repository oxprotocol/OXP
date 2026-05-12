import { useEffect, useState } from "react";
import { readGitState, type GitState } from "./git-reader";

const REFRESH_MS = 4000;

export function App(): JSX.Element {
  const [state, setState] = useState<GitState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const s = await readGitState();
      setState(s);
    } catch (err) {
      setState({
        insideRepo: false,
        repoRoot: null,
        branch: null,
        detached: false,
        headSha: null,
        recentCommits: [],
        lastFetchAgo: null,
        lastCommitAgo: null,
        error: (err as Error).message,
      });
    } finally {
      setRefreshing(false);
      setLastRefresh(Date.now());
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (!state) {
    return (
      <main className="gp">
        <p className="gp-loading">Loading git state…</p>
      </main>
    );
  }

  if (!state.insideRepo) {
    return (
      <main className="gp">
        <Header refreshing={refreshing} onRefresh={refresh} />
        <div className="gp-empty">
          <p>{state.error ?? "Not a git repository."}</p>
          <p className="gp-hint">
            Open a folder that contains a <code>.git</code> directory and the
            panel will populate automatically.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="gp">
      <Header refreshing={refreshing} onRefresh={refresh} />

      <section className="gp-branch">
        <span className="gp-branch-icon" aria-hidden></span>
        <span className="gp-branch-name" title={state.branch ?? "detached"}>
          {state.detached ? "(detached)" : (state.branch ?? "—")}
        </span>
        {state.headSha && <code className="gp-sha">{state.headSha}</code>}
      </section>

      <Section title="Recent commits">
        {state.recentCommits.length === 0 ? (
          <p className="gp-muted">
            No reflog entries yet. Make a commit to populate this list.
          </p>
        ) : (
          <ul className="gp-commits">
            {state.recentCommits.map((c) => (
              <li key={c.fullSha + c.whenIso} className="gp-commit">
                <code className="gp-sha">{c.shortSha}</code>
                <div className="gp-commit-body">
                  <div className="gp-commit-msg" title={c.message}>
                    {c.message}
                  </div>
                  <div className="gp-commit-meta">
                    <span>{c.author}</span>
                    <span aria-hidden> · </span>
                    <span>{relativeTime(c.whenIso)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activity">
        <dl className="gp-stats">
          <dt>Last commit</dt>
          <dd>
            {state.lastCommitAgo ? relativeTime(state.lastCommitAgo) : "—"}
          </dd>
          <dt>Last fetch</dt>
          <dd>
            {state.lastFetchAgo ? relativeTime(state.lastFetchAgo) : "never"}
          </dd>
        </dl>
      </Section>

      <footer className="gp-footer">
        <span className="gp-muted">
          Updated {relativeTime(new Date(lastRefresh).toISOString())} ·
          refreshes every {REFRESH_MS / 1000}s
        </span>
      </footer>
    </main>
  );
}

function Header({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <header className="gp-header">
      <div className="gp-title">
        <span className="gp-dot" aria-hidden />
        <strong>git panel</strong>
      </div>
      <button
        className="gp-refresh"
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
        title="Refresh now"
      >
        {refreshing ? "…" : "↻"}
      </button>
    </header>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="gp-section">
      <h2 className="gp-h2">{title}</h2>
      {children}
    </section>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
