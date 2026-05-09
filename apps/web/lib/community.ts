/**
 * Live community stats fetchers.
 *
 * Every helper returns a typed snapshot or `null` on failure — never throws —
 * so the community page can render gracefully when GitHub or Discord are
 * down, rate-limited, or unconfigured.
 *
 * Caching: we hint Next's data cache with `revalidate` so we don't hammer
 * the public APIs on every request. GitHub stats refresh every 30 minutes,
 * Discord widget every 5 minutes.
 */

const GITHUB_ORG = process.env.NEXT_PUBLIC_GITHUB_ORG ?? "oxprotocol";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
const DISCORD_GUILD_ID = process.env.NEXT_PUBLIC_DISCORD_GUILD_ID ?? "";
const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? "https://discord.gg/oxprotocol";

export interface GithubRepo {
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  url: string;
  openIssues: number;
  language: string | null;
}

export interface GithubOrgStats {
  org: string;
  url: string;
  totalStars: number;
  totalRepos: number;
  topRepos: GithubRepo[];
}

export interface GithubContributor {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
}

export interface DiscordWidget {
  name: string;
  presenceCount: number;
  inviteUrl: string;
}

const ghHeaders = (): Record<string, string> => {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "oxp.sh-web",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
};

/** Get public repo list for the configured account, sorted by stars (desc).
 *
 * GitHub exposes two distinct endpoints:
 *   /orgs/{org}/repos     — only works for Organisation accounts
 *   /users/{user}/repos   — only works for personal accounts
 *
 * We try `orgs` first and fall back to `users` on 404, so the same env var
 * works whether the configured handle is an org or a user.
 */
export async function getOrgStats(): Promise<GithubOrgStats | null> {
  if (!GITHUB_ORG) {
    console.warn("[community] NEXT_PUBLIC_GITHUB_ORG is not set");
    return null;
  }

  const tryFetch = async (kind: "orgs" | "users") => {
    const url = `https://api.github.com/${kind}/${GITHUB_ORG}/repos?per_page=100&type=public&sort=updated`;
    const res = await fetch(url, {
      headers: ghHeaders(),
      next: { revalidate: 60 * 30, tags: ["gh-org"] },
    });
    return res;
  };

  try {
    let res = await tryFetch("orgs");
    if (res.status === 404) res = await tryFetch("users");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[community] GitHub repos for "${GITHUB_ORG}" failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      );
      return null;
    }
    const data = (await res.json()) as Array<{
      name: string;
      full_name: string;
      description: string | null;
      stargazers_count: number;
      html_url: string;
      open_issues_count: number;
      language: string | null;
      fork: boolean;
      archived: boolean;
    }>;

    const repos: GithubRepo[] = data
      .filter((r) => !r.fork && !r.archived)
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        url: r.html_url,
        openIssues: r.open_issues_count,
        language: r.language,
      }))
      .sort((a, b) => b.stars - a.stars);

    return {
      org: GITHUB_ORG,
      url: `https://github.com/${GITHUB_ORG}`,
      totalStars: repos.reduce((sum, r) => sum + r.stars, 0),
      totalRepos: repos.length,
      topRepos: repos.slice(0, 6),
    };
  } catch (err) {
    console.error("[community] GitHub fetch threw:", err);
    return null;
  }
}

/**
 * Aggregate top contributors across the org's most-active repos.
 * GitHub doesn't expose an org-level contributors endpoint, so we walk the
 * top N repos and merge by login. Bots are filtered out.
 */
export async function getTopContributors(
  limit = 8,
  scanRepos = 5,
): Promise<GithubContributor[] | null> {
  const stats = await getOrgStats();
  if (!stats) return null;

  const reposToScan = stats.topRepos.slice(0, scanRepos);
  if (reposToScan.length === 0) return [];

  const merged = new Map<string, GithubContributor>();

  await Promise.all(
    reposToScan.map(async (repo) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo.fullName}/contributors?per_page=30&anon=false`,
          {
            headers: ghHeaders(),
            next: { revalidate: 60 * 30, tags: ["gh-contrib"] },
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          login?: string;
          avatar_url?: string;
          html_url?: string;
          contributions?: number;
          type?: string;
        }>;
        for (const c of data) {
          if (!c.login || c.type === "Bot" || c.login.endsWith("[bot]"))
            continue;
          const prev = merged.get(c.login);
          const contributions =
            (prev?.contributions ?? 0) + (c.contributions ?? 0);
          merged.set(c.login, {
            login: c.login,
            avatarUrl: c.avatar_url ?? "",
            htmlUrl: c.html_url ?? `https://github.com/${c.login}`,
            contributions,
          });
        }
      } catch {
        /* ignore — partial data is fine */
      }
    }),
  );

  return [...merged.values()]
    .sort((a, b) => b.contributions - a.contributions)
    .slice(0, limit);
}

/** Discord widget — requires the guild to have "Server Widget" enabled. */
export async function getDiscordWidget(): Promise<DiscordWidget | null> {
  if (!DISCORD_GUILD_ID) {
    console.warn("[community] NEXT_PUBLIC_DISCORD_GUILD_ID is not set");
    return null;
  }
  try {
    const res = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json`,
      {
        headers: { "User-Agent": "oxp.sh-web" },
        next: { revalidate: 60 * 5, tags: ["discord-widget"] },
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[community] Discord widget failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}. ` +
          `Enable Server Settings → Widget → "Enable Server Widget".`,
      );
      return null;
    }
    const data = (await res.json()) as {
      name?: string;
      presence_count?: number;
      instant_invite?: string | null;
    };
    return {
      name: data.name ?? "OXP Protocol",
      presenceCount: data.presence_count ?? 0,
      inviteUrl: data.instant_invite ?? DISCORD_INVITE_URL,
    };
  } catch (err) {
    console.error("[community] Discord fetch threw:", err);
    return null;
  }
}

export const COMMUNITY_LINKS = {
  github: `https://github.com/${GITHUB_ORG}`,
  discord: DISCORD_INVITE_URL,
  discussions: `https://github.com/${GITHUB_ORG}/discussions`,
  rfcs: "/rfcs",
  twitterHandle: process.env.NEXT_PUBLIC_TWITTER_HANDLE ?? "oxprotocol",
};
