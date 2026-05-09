import * as vscode from "vscode";
import type { HostFs } from "@oxprotocol/host-core";

/**
 * VS Code adapter for HostFs. Uses workspace.fs so paths integrate with
 * VS Code's URI scheme for globalStorageUri / workspaceFolder etc.
 *
 * Paths are passed as strings (vscode.Uri.toString()) and reconstructed via
 * vscode.Uri.parse() at the boundary.
 */
export function vscodeHostFs(): HostFs {
  const toUri = (s: string): vscode.Uri => vscode.Uri.parse(s);

  return {
    async exists(p: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(toUri(p));
        return true;
      } catch {
        return false;
      }
    },
    async mkdirp(p: string): Promise<void> {
      await vscode.workspace.fs.createDirectory(toUri(p));
    },
    async readFile(p: string): Promise<Uint8Array> {
      return await vscode.workspace.fs.readFile(toUri(p));
    },
    async writeFile(p: string, bytes: Uint8Array): Promise<void> {
      const uri = toUri(p);
      const parent = vscode.Uri.joinPath(uri, "..");
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(uri, bytes);
    },
    async rm(p: string): Promise<void> {
      try {
        await vscode.workspace.fs.delete(toUri(p), {
          recursive: true,
          useTrash: false,
        });
      } catch {
        /* ignore missing */
      }
    },
    join(...segments: string[]): string {
      const [head, ...rest] = segments;
      if (!head) throw new Error("join() requires at least one segment");
      return vscode.Uri.joinPath(toUri(head), ...rest).toString();
    },
  };
}
