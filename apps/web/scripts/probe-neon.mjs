import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

for (const k of ["NEON_DATABASE_URL", "NEON_DIRECT_URL"]) {
  const c = new pg.Client({ connectionString: env[k] });
  try {
    await c.connect();
    const r = await c.query("select current_database() db, current_user usr");
    console.log(k, "OK", r.rows[0]);
    await c.end();
  } catch (e) {
    console.log(k, "FAIL", e.message);
  }
}
