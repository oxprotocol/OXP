// OXP v1 Conformance Probe.
//
// This extension exercises every contribution point listed in
// spec/v1/oxp-api.md. Each host adapter's automation harness drives it
// through the scenarios in ../scenarios/*.json and verifies behaviour.
//
// The extension MUST run unmodified against every host. If a host can't
// support a code path here, the host (not this file) is non-conforming.

import type { OxpContext, Disposable } from "@oxprotocol/sdk";

export async function activate(ctx: OxpContext): Promise<void> {
  const disposables: Disposable[] = [];

  // 1. commands ──────────────────────────────────────────────────────────
  disposables.push(
    ctx.commands.register("conf.greet", async (arg?: unknown) => {
      ctx.window.showMessage(`hello ${String(arg ?? "world")}`);
      return { ok: true, echoed: arg };
    }),
  );

  // 2. menus / keybindings — declared in oxp.json; nothing to do at runtime.

  // 3. statusBar ─────────────────────────────────────────────────────────
  const status = ctx.statusBar.create({ alignment: "right", priority: 100 });
  status.text = "$(check) conf";
  status.tooltip = "OXP conformance probe is live";
  status.commandId = "conf.greet";
  status.show();
  disposables.push(status);

  // 4. tree view ─────────────────────────────────────────────────────────
  disposables.push(
    ctx.tree.register({
      viewId: "conf.tree",
      provider: {
        getChildren: async (parent) => {
          if (!parent) {
            return [
              {
                id: "a",
                label: "Alpha",
                collapsibleState: "collapsed",
                contextValue: "group",
              },
              {
                id: "b",
                label: "Bravo",
                collapsibleState: "none",
                commandId: "conf.greet",
              },
            ];
          }
          if (parent.id === "a") {
            return [
              { id: "a.1", label: "Alpha child", collapsibleState: "none" },
            ];
          }
          return [];
        },
      },
    }),
  );

  // 5. window prompts ────────────────────────────────────────────────────
  disposables.push(
    ctx.commands.register("conf.pickColor", async () => {
      return ctx.window.showQuickPick(
        [
          { label: "Red", value: "#f00" },
          { label: "Green", value: "#0f0" },
          { label: "Blue", value: "#00f" },
        ],
        { placeholder: "Pick a color" },
      );
    }),
  );

  // 6. workspace fs ──────────────────────────────────────────────────────
  // Read README.md if present, write a marker, verify roundtrip.
  try {
    const folders = ctx.workspace.folders();
    if (folders.length > 0) {
      const marker = `oxp://workspace/out/conformance.marker`;
      await ctx.workspace.fs.createDirectory("oxp://workspace/out");
      await ctx.workspace.fs.writeFile(marker, new TextEncoder().encode("ok"));
      const back = await ctx.workspace.fs.readFile(marker);
      if (new TextDecoder().decode(back) !== "ok") {
        throw new Error("fs roundtrip failed");
      }
    }
  } catch (err) {
    ctx.window.showMessage(
      `workspace fs probe failed: ${(err as Error).message}`,
      "error",
    );
  }

  // 7. editor ────────────────────────────────────────────────────────────
  disposables.push(
    ctx.editor.onDidChange((ed) => {
      status.text = ed ? `$(file) ${ed.document.languageId}` : "$(check) conf";
    }),
  );

  // 8. terminal ──────────────────────────────────────────────────────────
  disposables.push(
    ctx.commands.register("conf.runTask", async () => {
      return ctx.window.showProgress(
        { title: "Conformance task" },
        async (progress) => {
          progress.report({ message: "starting" });
          const term = ctx.terminal.create({ name: "conf" });
          term.sendText("echo conformance");
          await sleep(200);
          term.dispose();
          progress.report({ message: "done" });
          return "completed";
        },
      );
    }),
  );

  // 9. language providers ────────────────────────────────────────────────
  disposables.push(
    ctx.languages.registerHoverProvider(
      { language: "typescript" },
      {
        async provideHover() {
          return { contents: ["**conformance** hover"] };
        },
      },
    ),
  );
  disposables.push(
    ctx.languages.registerCompletionProvider(
      { language: "typescript" },
      {
        async provideCompletionItems() {
          return [{ label: "oxpConformance", insertText: "oxpConformance" }];
        },
      },
      ["."],
    ),
  );

  // 10. network ──────────────────────────────────────────────────────────
  try {
    const res = await ctx.network.fetch("https://httpbin.org/get");
    await res.text();
  } catch {
    // network is best-effort in CI; scenario harness validates allow-list.
  }

  // 11. secrets ──────────────────────────────────────────────────────────
  await ctx.secrets.set("conf.token", "s3cr3t");
  if ((await ctx.secrets.get("conf.token")) !== "s3cr3t") {
    ctx.window.showMessage("secrets roundtrip failed", "error");
  }
  await ctx.secrets.delete("conf.token");

  // 12. state ────────────────────────────────────────────────────────────
  await ctx.state.workspace.set(
    "hits",
    ((await ctx.state.workspace.get("hits")) ?? 0) + 1,
  );

  // 13. webview ──────────────────────────────────────────────────────────
  const panel = ctx.webview.createPanel({
    id: "conf.panel",
    title: "Conformance",
    surface: "tab",
  });
  panel.setHtml(
    `<!doctype html><meta charset="utf-8"><title>conf</title><body>hello</body>`,
  );
  panel.onMessage((m) => panel.postMessage({ echoed: m }));
  disposables.push(panel);

  // 14. lifecycle ────────────────────────────────────────────────────────
  disposables.push(
    ctx.events.onWorkspaceChange(() => {
      status.tooltip = `workspace changed @ ${new Date().toISOString()}`;
    }),
  );

  // Stash for deactivate.
  (ctx as unknown as { __confDisposables: Disposable[] }).__confDisposables =
    disposables;
}

export async function deactivate(): Promise<void> {
  // Hosts must kill us after 5000ms if this hangs; the probe resolves
  // promptly when the bag of disposables drains.
  // (Real cleanup happens via the ctx passed into activate; we only get
  // here as a smoke check.)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
