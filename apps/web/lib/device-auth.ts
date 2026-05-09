/**
 * Helpers for the OAuth 2.0 Device Authorization Grant (RFC 8628) used by
 * the `oxp login` CLI flow. The CLI never embeds a client secret and never
 * runs an HTTP listener; it polls a short endpoint with a long opaque
 * `device_code` and the user approves the session in the browser.
 *
 * Security notes:
 * - We store only `sha256(deviceCode)` in the DB, identical to ApiToken.
 * - `userCode` is short and human-friendly (XXXX-XXXX with an unambiguous
 *   alphabet — no 0/O/1/I/L). Rate-limited to one approval attempt per
 *   second per session via the `consumedAt` and `expiresAt` checks.
 * - Sessions expire after `DEVICE_TTL_MS` (10 min). Polling clients see
 *   `slow_down` if they exceed the suggested interval (see route handler).
 * - Tokens minted via device-flow inherit the requested scopes, capped
 *   to whatever the approving user is allowed to grant — for now that is
 *   `publish:@<handle>/*` and any subset thereof.
 */

import { createHash, randomBytes } from "node:crypto";

export const DEVICE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DEVICE_POLL_INTERVAL_S = 2;
export const DEVICE_USER_CODE_TTL_DAYS = 90; // ApiToken expiry on approval

/** Unambiguous alphabet — no 0/O/1/I/L/Z/2 to keep dictation reliable. */
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXY3456789";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** 32 bytes hex → 64 char opaque token. Only the hash is stored. */
export function newDeviceCode(): string {
  return randomBytes(32).toString("hex");
}

/** "ABCD-1234" style. ~24 bits of entropy; brute-force is not the threat
 *  here (sessions expire in 10 min and lookups are gated by login state). */
export function newUserCode(): string {
  const pick = () => {
    const buf = randomBytes(4);
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += USER_CODE_ALPHABET[buf[i] % USER_CODE_ALPHABET.length];
    }
    return out;
  };
  return `${pick()}-${pick()}`;
}

/** Normalize what the user typed: uppercase, strip non-alphanumerics, then
 *  re-insert the dash. Tolerates pasted "abcd1234" or " abcd - 1234 ". */
export function normalizeUserCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
