<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 🔒 SECURITY LOCK — READ FIRST

**All non-security feature work on OXP is PAUSED** until Phase A, B, and C of [`ROADMAP-SECURITY.md`](./ROADMAP-SECURITY.md) are complete and signed off. Security is OXP's #1 differentiator and is non-negotiable.

If the user asks for a new feature, a refactor unrelated to security, a VSX import, an R2 migration, or any item from [`ROADMAP-FEATURES.md`](./ROADMAP-FEATURES.md):
1. Remind them of the lock and point at `ROADMAP-SECURITY.md`
2. Only proceed if they explicitly override the lock
3. If they override, note the deviation in the relevant roadmap file

For security work itself, follow the phase order strictly. Do not skip ahead. Update [`SECURITY.md`](./SECURITY.md) posture tables at the end of each phase.
