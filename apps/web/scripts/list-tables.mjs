import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const c = new pg.Client({ connectionString: env.NEON_DIRECT_URL });
await c.connect();
const r = await c.query(
  "select tablename from pg_tables where schemaname='public' order by tablename",
);
console.log("tables:", r.rows.map((x) => x.tablename).join(", "));
const t = await c.query("select count(*)::int as n from extensions");
console.log("extensions rows:", t.rows[0].n);
await c.end();
