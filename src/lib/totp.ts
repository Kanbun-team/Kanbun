// RFC 6238 time-based one-time passwords (HMAC-SHA1, 30 second steps,
// 6 digits), the scheme every authenticator app supports. Pure functions on
// node:crypto, no dependency.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift in steps on either side of "now". */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 without padding (what otpauth:// URIs use). */
export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes base32, ignoring case, spaces, dashes and padding. Throws on other characters. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random 160-bit secret, base32 encoded (32 characters). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP value for a counter. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function timeStep(nowMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(nowMs / 1000 / stepSeconds);
}

/** The code for a moment in time (defaults to now). */
export function totp(secret: Uint8Array, nowMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(secret, timeStep(nowMs), digits);
}

/** Strips spaces so "123 456" works; returns null when it is not a 6 digit code. */
export function normalizeTotpCode(code: string): string | null {
  const clean = code.replace(/\s/g, "");
  return /^\d{6}$/.test(clean) ? clean : null;
}

/**
 * Checks a code against the steps around `nowMs`. Returns the matched time
 * step, or null. Steps at or before `lastUsedStep` are rejected, so a code can
 * be used only once (store the returned step as the new `lastUsedStep`).
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): number | null {
  const clean = normalizeTotpCode(code);
  if (!clean) return null;
  const current = timeStep(nowMs);
  const given = Buffer.from(clean);
  let matched: number | null = null;
  // Check every step in the window (no early exit) so timing does not reveal which matched.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && matched <= lastUsedStep) return null;
  return matched;
}

/** otpauth:// URI that authenticator apps read from the QR code. */
export function otpauthUri({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

/** Groups a base32 secret in blocks of four for manual entry. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
