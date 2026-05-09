import { describe, expect, it, vi } from "vitest";
import {
  buildBroker,
  PERMISSIONS,
  RuntimeError,
  nullBackend,
  type HostCapabilityProvider,
  type RuntimeManifestSlice,
} from "../src/index.js";

const noopLog = { log: vi.fn() };
const noopStorage = {
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  keys: vi.fn().mockResolvedValue([]),
};
const noopUi = {
  render: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockResolvedValue(undefined),
};

const baseProvider = (): HostCapabilityProvider => ({
  log: { ...noopLog, log: vi.fn() },
  storage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  },
  ui: { ...noopUi, render: vi.fn().mockResolvedValue(undefined) },
  fs: {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([1])),
    writeFile: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, isDir: false, mtimeMs: 0 }),
    listDir: vi.fn().mockResolvedValue([]),
  },
  net: {
    fetch: vi
      .fn()
      .mockResolvedValue({ status: 200, headers: [], body: new Uint8Array() }),
  },
  secrets: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  commands: { execute: vi.fn().mockResolvedValue('"ok"') },
});

const manifest = (perms: string[] = []): RuntimeManifestSlice => ({
  id: "@acme/test",
  version: "0.0.1",
  permissions: perms,
});

describe("buildBroker — always-on capabilities", () => {
  it("exposes log/storage/ui without any permission", () => {
    const b = buildBroker(baseProvider(), manifest([]));
    expect(b.log).toBeDefined();
    expect(b.storage).toBeDefined();
    expect(b.ui).toBeDefined();
  });

  it("omits gated surfaces when no permission granted", () => {
    const b = buildBroker(baseProvider(), manifest([]));
    expect(b.fs).toBeUndefined();
    expect(b.net).toBeUndefined();
    expect(b.secrets).toBeUndefined();
    expect(b.commands).toBeUndefined();
  });
});

describe("buildBroker — fs gate", () => {
  it("exposes fs when fs.read granted, but writeFile denies", async () => {
    const b = buildBroker(baseProvider(), manifest([PERMISSIONS.FS_READ]));
    expect(b.fs).toBeDefined();
    await expect(b.fs!.readFile("/x")).resolves.toBeInstanceOf(Uint8Array);
    await expect(b.fs!.writeFile("/x", new Uint8Array())).rejects.toMatchObject(
      {
        name: "RuntimeError",
        code: "PERMISSION_DENIED",
      },
    );
    await expect(b.fs!.delete("/x")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("write requires fs.write; read still denied if only fs.write granted", async () => {
    const b = buildBroker(baseProvider(), manifest([PERMISSIONS.FS_WRITE]));
    await expect(
      b.fs!.writeFile("/x", new Uint8Array()),
    ).resolves.toBeUndefined();
    await expect(b.fs!.readFile("/x")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("throws if manifest declares fs.* but provider missing", () => {
    const p = baseProvider();
    delete p.fs;
    expect(() => buildBroker(p, manifest([PERMISSIONS.FS_READ]))).toThrow(
      RuntimeError,
    );
  });
});

describe("buildBroker — net/secrets/commands gates", () => {
  it("net exposed iff net.fetch granted", () => {
    expect(buildBroker(baseProvider(), manifest([])).net).toBeUndefined();
    expect(
      buildBroker(baseProvider(), manifest([PERMISSIONS.NET_FETCH])).net,
    ).toBeDefined();
  });

  it("secrets.read allows get but blocks set/delete", async () => {
    const b = buildBroker(baseProvider(), manifest([PERMISSIONS.SECRETS_READ]));
    await expect(b.secrets!.get("k")).resolves.toBeUndefined();
    await expect(b.secrets!.set("k", "v")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(b.secrets!.delete("k")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("commands gated", () => {
    expect(buildBroker(baseProvider(), manifest([])).commands).toBeUndefined();
    expect(
      buildBroker(baseProvider(), manifest([PERMISSIONS.COMMANDS_EXECUTE_HOST]))
        .commands,
    ).toBeDefined();
  });

  it("missing provider for granted permission throws synchronously", () => {
    const p = baseProvider();
    delete p.net;
    expect(() => buildBroker(p, manifest([PERMISSIONS.NET_FETCH]))).toThrow(
      /net provider/,
    );
  });
});

describe("nullBackend", () => {
  it("rejects instantiate with UNSUPPORTED_BACKEND", async () => {
    const rt = nullBackend();
    expect(rt.name).toBe("null");
    const broker = buildBroker(baseProvider(), manifest([]));
    await expect(
      rt.instantiate(new Uint8Array([0, 1, 2]), {
        manifest: manifest(),
        broker,
      }),
    ).rejects.toMatchObject({
      name: "RuntimeError",
      code: "UNSUPPORTED_BACKEND",
    });
  });
});
