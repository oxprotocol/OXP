/**
 * GitHub URL/identity helpers used by the VSX claim flow.
 *
 * Open VSX manifests carry a free-form `repository.url` field that we use
 * to derive the *real* GitHub owner of an extension's source. We accept
 * the common URL shapes seen in the wild:
 *
 *   - https://github.com/microsoft/vscode-python
 *   - https://github.com/microsoft/vscode-python.git
 *   - http://github.com/owner/repo
 *   - git+https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git           (ssh)
 *   - ssh://git@github.com/owner/repo.git
 *   - github:owner/repo                        (npm shorthand)
 *
 * Reject anything that points at a non-github host (gitlab, bitbucket,
 * self-hosted) — for those we fall back to the curated brand list and
 * domain proof.
 */

const RESERVED_GH_PATHS = new Set([
  "orgs",
  "settings",
  "marketplace",
  "topics",
  "trending",
  "explore",
  "notifications",
  "pulls",
  "issues",
  "search",
  "login",
  "join",
  "logout",
  "new",
  "about",
  "pricing",
  "features",
  "enterprise",
  "sponsors",
]);

export function parseGithubOrg(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip common npm/git prefixes.
  if (s.startsWith("git+")) s = s.slice(4);
  if (s.startsWith("github:")) s = "https://github.com/" + s.slice(7);

  // ssh: `git@github.com:owner/repo(.git)?`
  if (s.startsWith("git@github.com:")) {
    s = "https://github.com/" + s.slice("git@github.com:".length);
  }

  // ssh URI: `ssh://git@github.com/owner/repo`
  if (s.startsWith("ssh://")) {
    s = s.replace(/^ssh:\/\/(?:git@)?/, "https://");
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const owner = segments[0]?.toLowerCase().replace(/\.git$/, "");
  if (!owner) return null;
  if (RESERVED_GH_PATHS.has(owner)) return null;
  // GitHub usernames: [a-z0-9-], 1-39, no leading/trailing hyphen.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)) return null;

  return owner;
}

/**
 * Returns true when `login` is a public member of `org`. Uses the
 * unauthenticated GitHub REST endpoint that returns 204 for public
 * members and 404 otherwise. Private memberships are not visible to
 * unauthenticated callers — those publishers must surface their
 * membership publicly OR claim via Level 3 domain proof.
 *
 * Network failures (timeout, rate-limit) return false so the claim
 * gate stays closed-fail.
 */
export async function isPublicOrgMember(
  org: string,
  login: string,
): Promise<boolean> {
  const o = org.toLowerCase();
  const l = login.toLowerCase();
  if (!o || !l) return false;

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(o)}/public_members/${encodeURIComponent(l)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "oxp.sh registry/1.0",
          "x-github-api-version": "2022-11-28",
        },
        // Short cache: org membership rarely flips, but we don't want a
        // permanent stale "no" to block a legit claim.
        next: { revalidate: 300 },
      },
    );
    return res.status === 204;
  } catch {
    return false;
  }
}
