#!/usr/bin/env node
// Drives @oxprotocol/host-core install pipeline against live registry.
// Verifies Phase A.7 TOFU pin: 1st install creates pin, 2nd succeeds w/ same key,
// tampered trust.json triggers KEY_PINNING_VIOLATION.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { resolveAndVerify, Store, VerifyError } from "@oxprotocol/host-core";

const ROOT = "/tmp/oxp-host/store";
const REGISTRY = process.env.OXP_REGISTRY ?? "https://oxp.sh";
const ID = process.env.OXP_TEST_ID ?? "@aldgar/first-extension";

const nodeFs = {
  exists: async (p) => existsSync(p),
  mkdirp: async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
  readFile: async (p) => fs.readFile(p),
  writeFile: async (p, b) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, b);
  },
  rm: async (p) => {
    await fs.rm(p, { recursive: true, force: true });
  },
  join: (...s) => path.join(...s),
};

async function step(label, fn) {
  process.stdout.write(`→ ${label} … `);
  try {
    const r = await fn();
    console.log("✓");
    return r;
  } catch (e) {
    console.log("✗");
    throw e;
  }
}

const store = new Store(nodeFs, ROOT);

console.log(`Registry: ${REGISTRY}\nStore root: ${ROOT}\nExtension: ${ID}\n`);

// PASS 1: clean install — should TOFU-pin the publisher key
const v1 = await step("resolve+verify (pass 1)", () =>
  resolveAndVerify(REGISTRY, ID),
);
const r1 = await step("install (pass 1)", () => store.install(v1));
console.log(`   keyId pinned: ${r1.keyId}`);

const trust1 = JSON.parse(
  await fs.readFile(path.join(ROOT, "trust.json"), "utf8"),
);
console.log(`   trust.json:`, JSON.stringify(trust1, null, 2));

// PASS 2: re-install — should succeed, same key
const v2 = await step("resolve+verify (pass 2)", () =>
  resolveAndVerify(REGISTRY, ID),
);
const r2 = await step("install (pass 2, same key)", () => store.install(v2));
console.log(`   ✓ same key accepted: ${r2.keyId}`);

// PASS 3: tamper pin to a fake keyId — must fail KEY_PINNING_VIOLATION
const tampered = trust1.map((p) => ({ ...p, keyId: "ed25519:0xdeadbeef" }));
await fs.writeFile(
  path.join(ROOT, "trust.json"),
  JSON.stringify(tampered, null, 2),
);
console.log("→ tampered trust.json with bogus keyId");

let blocked = false;
try {
  const v3 = await resolveAndVerify(REGISTRY, ID);
  await store.install(v3);
} catch (e) {
  if (e instanceof VerifyError && e.code === "KEY_PINNING_VIOLATION") {
    blocked = true;
    console.log(`✓ install blocked: ${e.code}`);
  } else throw e;
}
if (!blocked) {
  console.error("✗ FAIL: tampered pin did NOT block install");
  process.exit(1);
}

console.log("\n✓ ALL PASSES OK — Phase A.7 TOFU verified end-to-end.");
