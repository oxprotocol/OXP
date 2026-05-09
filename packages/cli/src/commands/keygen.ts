import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  generateEd25519KeyPair,
  keyIdOf,
  type Ed25519KeyPair,
} from "@oxprotocol/bundle";
import { oxpHome, info } from "../util.js";

/**
 * Get (or lazily create) the local Ed25519 publisher key pair.
 *
 * Stored under `${OXP_HOME}/keys/default.{key,pub}.pem` — one shared key
 * per workstation for the MVP. Future versions will support per-publisher
 * keys + Sigstore.
 */
export async function loadOrCreateKey(): Promise<
  Ed25519KeyPair & { keyId: string }
> {
  const dir = join(oxpHome(), "keys");
  const privPath = join(dir, "default.key.pem");
  const pubPath = join(dir, "default.pub.pem");

  try {
    const [privateKeyPem, publicKeyPem] = await Promise.all([
      fs.readFile(privPath, "utf8"),
      fs.readFile(pubPath, "utf8"),
    ]);
    return { privateKeyPem, publicKeyPem, keyId: keyIdOf(publicKeyPem) };
  } catch {
    // create
  }

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const kp = generateEd25519KeyPair();
  await fs.writeFile(privPath, kp.privateKeyPem, { mode: 0o600 });
  await fs.writeFile(pubPath, kp.publicKeyPem, { mode: 0o644 });
  info(`generated Ed25519 key: ${keyIdOf(kp.publicKeyPem)}`);
  info(`  private: ${privPath}`);
  info(`  public:  ${pubPath}`);
  return { ...kp, keyId: keyIdOf(kp.publicKeyPem) };
}

export async function keygen(_args: string[]): Promise<number> {
  const k = await loadOrCreateKey();
  info(k.keyId);
  return 0;
}
