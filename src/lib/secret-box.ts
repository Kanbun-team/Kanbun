// Encryption at rest for small secrets (TOTP seeds). AES-256-GCM with a key
// derived from AUTH_SECRET via HKDF, so a copied database alone does not
// reveal the secrets. Rotating AUTH_SECRET makes stored secrets unreadable:
// affected users then need an admin to reset their two-factor setup.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

export function appSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/** A 32-byte key for one purpose, derived from the app secret. */
export function deriveKey(purpose: string, secret: string = appSecret()): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "kanbun", purpose, 32));
}

export function encryptSecret(plain: string, secret: string = appSecret()): string {
  const key = deriveKey("totp-secret-v1", secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, data]).toString("base64")}`;
}

/** Returns null when the value is malformed or was encrypted with another key. */
export function decryptSecret(stored: string, secret: string = appSecret()): string | null {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) return null;
  try {
    const raw = Buffer.from(payload, "base64");
    if (raw.length < 29) return null;
    const key = deriveKey("totp-secret-v1", secret);
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Keyed hash (HMAC-SHA256) for values that are only ever compared, like recovery codes. */
export function keyedHash(value: string, purpose: string, secret: string = appSecret()): string {
  return createHmac("sha256", deriveKey(purpose, secret)).update(value).digest("hex");
}
