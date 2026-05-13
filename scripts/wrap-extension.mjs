#!/usr/bin/env node
/**
 * Manual proof-of-concept: generate + install a wrapper VSIX for one
 * already-installed OXP extension.
 *
 * Usage:
 *   node scripts/wrap-extension.mjs @aldgar/icon
 *
 * Looks the extension up in `~/.oxp/host-store/extensions/<pub>/<slug>/`,
 * picks the newest version on disk, generates a wrapper VSIX with the
 * extension's icon + name, and installs it into VS Code (and Cursor,
 * if present) via `--install-extension`.
 *
 * After the install you should see a new Activity Bar item appear with
 * the extension's icon. If VS Code remembers an old placement, that
 * same view may show only as a header under Explorer (ICON / Outline)
 * instead of beside Explorer — run Command Palette >
 * View: Reset View Locations, then Reload Window, so the Activity Bar
 * picks it up again.
 *
 * Clicking it asks the OXP host extension for
 * the bridge-wired webview provider, which renders the extension's
 * main.ui HTML inside the slot.
 *
 * This script is intentionally standalone so we can prove the
 * architecture works *before* wiring it into the CLI's install
 * command. Once you confirm one extension renders correctly, we'll
 * integrate the same code path into `oxp install`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOST_EXTENSION_ID = "oxprotocol.oxp-vscode";

const id = process.argv[2];
if (!id || !/^@[^/]+\/[^/]+$/.test(id)) {
  console.error("Usage: node scripts/wrap-extension.mjs @publisher/slug");
  process.exit(1);
}

const oxpHome = process.env.OXP_HOME ?? path.join(homedir(), ".oxp");
const [pub, slug] = id.replace(/^@/, "").split("/", 2);
const slugDir = path.join(oxpHome, "host-store", "extensions", pub, slug);
if (!existsSync(slugDir)) {
  console.error(`Not installed: ${id} (looked under ${slugDir})`);
  process.exit(1);
}
const versions = readdirSync(slugDir).sort().reverse();
if (versions.length === 0) {
  console.error(`No versions of ${id} installed under ${slugDir}`);
  process.exit(1);
}
const version = versions[0];
const installDir = path.join(slugDir, version);
const manifest = JSON.parse(
  readFileSync(path.join(installDir, "oxp.json"), "utf8"),
);
const displayName = manifest.displayName ?? id;
const iconRel = typeof manifest.icon === "string" ? manifest.icon : null;

const wrapperPublisher = `oxp`;
const wrapperName = `${slugify(pub)}-${slugify(slug)}`;
const wrapperId = `${wrapperPublisher}.${wrapperName}`;
const containerId = `oxp.${slugify(pub)}.${slugify(slug)}`;
const viewId = `${containerId}.view`;

const stagingDir = path.join(tmpdir(), `oxp-wrapper-${Date.now()}`);
mkdirSync(stagingDir, { recursive: true });

const iconName = stageIcon();

const pkg = {
  name: wrapperName,
  displayName,
  description: `OXP wrapper for ${id}@${version}.`,
  version,
  publisher: wrapperPublisher,
  icon: iconName,
  engines: { vscode: "^1.95.0" },
  main: "./extension.js",
  extensionDependencies: [HOST_EXTENSION_ID],
  activationEvents: [`onView:${viewId}`, "onStartupFinished"],
  contributes: {
    viewsContainers: {
      activitybar: [
        { id: containerId, title: displayName, icon: iconName },
      ],
    },
    views: {
      [containerId]: [
        { type: "webview", id: viewId, name: displayName },
      ],
    },
  },
};
writeFileSync(
  path.join(stagingDir, "package.json"),
  JSON.stringify(pkg, null, 2),
);

const extensionJs = `
"use strict";
const vscode = require("vscode");

const OXP_EXTENSION_ID = ${JSON.stringify(id)};
const VIEW_ID = ${JSON.stringify(viewId)};
const HOST_ID = ${JSON.stringify(HOST_EXTENSION_ID)};

async function activate(context) {
  const host = vscode.extensions.getExtension(HOST_ID);
  if (!host) {
    vscode.window.showErrorMessage(
      "OXP Host is not installed. Install '" + HOST_ID + "' to use this extension."
    );
    return;
  }
  if (!host.isActive) {
    try { await host.activate(); } catch (err) {
      vscode.window.showErrorMessage(
        "Failed to activate OXP Host: " + (err && err.message ? err.message : String(err))
      );
      return;
    }
  }
  const api = host.exports;
  if (!api || typeof api.createWebviewProvider !== "function") {
    vscode.window.showErrorMessage(
      "OXP Host is too old. Update '" + HOST_ID + "' to use this extension."
    );
    return;
  }
  const provider = api.createWebviewProvider(OXP_EXTENSION_ID);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
}

function deactivate() {}

exports.activate = activate;
exports.deactivate = deactivate;
`;
writeFileSync(path.join(stagingDir, "extension.js"), extensionJs);

writeFileSync(
  path.join(stagingDir, "README.md"),
  `# ${displayName}\n\nOXP wrapper for \`${id}@${version}\`.\n`,
);

const vsixPath = path.join(stagingDir, `${wrapperId}-${version}.vsix`);
console.log("\n▸ packaging wrapper VSIX with @vscode/vsce …");
const pkgRes = spawnSync(
  "npx",
  ["--yes", "@vscode/vsce", "package", "--no-dependencies", "--out", vsixPath, "--skip-license"],
  { cwd: stagingDir, encoding: "utf8", timeout: 120_000, stdio: "inherit" },
);
if (pkgRes.status !== 0) {
  console.error("✗ vsce package failed");
  process.exit(1);
}
console.log(`✓ packaged: ${vsixPath}`);

const ides = [
  { name: "VS Code", cli: "code" },
  { name: "Cursor", cli: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" },
];

let anyInstalled = false;
for (const ide of ides) {
  if (!existsSync(ide.cli) && ide.cli !== "code") {
    console.log(`▸ ${ide.name}: skipped (CLI not found at ${ide.cli})`);
    continue;
  }
  console.log(`▸ installing into ${ide.name} …`);
  const r = spawnSync(ide.cli, ["--install-extension", vsixPath, "--force"], {
    encoding: "utf8",
  });
  if (r.status === 0) {
    console.log(`  ✓ ${ide.name} installed wrapper`);
    anyInstalled = true;
  } else {
    console.log(`  ✗ ${ide.name} failed (exit ${r.status})`);
    console.log("   " + ((r.stdout || "") + (r.stderr || "")).trim());
  }
}

if (anyInstalled) {
  console.log(`\nReload your editor window to see "${displayName}" in the Activity Bar.`);
  console.log(`Uninstall later with:`);
  console.log(`  code --uninstall-extension ${wrapperId}`);
}

function stageIcon() {
  if (iconRel) {
    const source = path.join(installDir, iconRel);
    if (existsSync(source)) {
      const ext = path.extname(iconRel).toLowerCase() || ".svg";
      const dest = path.join(stagingDir, `icon${ext}`);
      copyFileSync(source, dest);
      return `icon${ext}`;
    }
  }
  // Fallback if the extension didn't ship an icon.
  const initial = (displayName || id).trim().charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="4" ry="4" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-family="system-ui,Helvetica,Arial,sans-serif" font-size="11" font-weight="600">${esc(initial)}</text></svg>`;
  writeFileSync(path.join(stagingDir, "icon.svg"), svg);
  return "icon.svg";
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}
function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}
