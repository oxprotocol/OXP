import { useState } from "react";

/**
 * Replace this with whatever your extension does. Everything inside the
 * panel is plain React + DOM — no host-specific APIs needed for UI work.
 *
 * To talk to the host (read settings, run commands, log telemetry, etc.)
 * import from `@oxprotocol/sdk` and add the matching permission to
 * `oxp.json#permissions`.
 */
export function App(): JSX.Element {
  const [count, setCount] = useState(0);

  return (
    <main className="oxp-card">
      <header className="oxp-header">
        <span className="oxp-dot" aria-hidden />
        <span className="oxp-brand">OXP</span>
        <span className="oxp-slug">@__PUBLISHER__/__SLUG__</span>
      </header>

      <h1>__DISPLAY_NAME__</h1>
      <p className="oxp-lede">
        React + TypeScript panel running inside your IDE.
      </p>

      <button
        className="oxp-btn"
        type="button"
        onClick={() => setCount((c) => c + 1)}
      >
        Pressed {count} {count === 1 ? "time" : "times"}
      </button>

      <p className="oxp-hint">
        Edit <code>src/App.tsx</code> and save — the panel hot-reloads.
      </p>

      <footer className="oxp-footer">
        <a
          href="https://oxp.sh/docs/getting-started"
          target="_blank"
          rel="noreferrer"
        >
          Docs ↗
        </a>
        <span aria-hidden>·</span>
        <a href="https://oxp.sh/docs/api" target="_blank" rel="noreferrer">
          SDK API ↗
        </a>
      </footer>
    </main>
  );
}
