// Single-use recovery codes for two-factor authentication. Each code has 60
// random bits (12 base32 characters, shown as xxxx-xxxx-xxxx) and is stored
// only as a keyed hash, so the plain codes are shown once and never again.

import { randomBytes } from "node:crypto";
import { base32Encode } from "@/lib/totp";
import { keyedHash } from "@/lib/secret-box";

export const RECOVERY_CODE_COUNT = 10;

function oneCode(): string {
  // 8 random bytes give 13 base32 characters; keep 12 (60 bits).
  const raw = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(oneCode());
  return [...codes];
}

/** Lowercase, no spaces or dashes; null when it can not be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-z2-7]{12}$/.test(clean) ? clean : null;
}

export function hashRecoveryCode(code: string, secret?: string): string | null {
  const clean = normalizeRecoveryCode(code);
  if (!clean) return null;
  return keyedHash(clean, "recovery-code-v1", secret);
}
