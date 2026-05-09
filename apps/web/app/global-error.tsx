"use client";

export const dynamic = "force-dynamic";

/**
 * Root error boundary for the entire app. Required as its own component
 * because Next 16 prerenders the auto-generated default error page outside
 * the normal `app/layout.tsx` (so providers/contexts aren't mounted) — that
 * fails for our app since `Navbar` reads context. This minimal version
 * stands in.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#060a13",
          color: "#f8fafc",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            marginBottom: "0.5rem",
          }}
        >
          Something went wrong
        </h1>
        {error.digest ? (
          <p
            style={{
              opacity: 0.5,
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
            }}
          >
            digest: {error.digest}
          </p>
        ) : null}
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: "0.5rem 1rem",
            border: "1px solid rgba(248,250,252,0.2)",
            borderRadius: "0.375rem",
            background: "transparent",
            color: "#f8fafc",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
