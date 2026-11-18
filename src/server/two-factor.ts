// Server side of two-factor authentication: checking a code at login and in
// settings, replay protection and recovery codes. Pure TOTP math is in
// src/lib/totp.ts. Server-only.

import { prisma } from "@/lib/db-local";
import { base32Decode, normalizeTotpCode, verifyTotp } from "@/lib/totp";
import { decryptSecret } from "@/lib/secret-box";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery-codes";
import { audit } from "@/server/audit";

export type SecondFactorResult = "ok" | "required" | "invalid";

interface TwoFactorUser {
  id: string;
  username: string;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
}

/** The decrypted base32 secret, or null if missing or unreadable (AUTH_SECRET changed). */
export function readTotpSecret(stored: string | null): string | null {
  return stored ? decryptSecret(stored) : null;
}

/**
 * Accepts a TOTP code once. The last used step is updated with a conditional
 * write, so two requests racing with the same code can not both succeed.
 */
export async function consumeTotpCode(user: TwoFactorUser, code: string): Promise<boolean> {
  const secret = readTotpSecret(user.totpSecret);
  if (!secret) return false;
  const step = verifyTotp(base32Decode(secret), code, Date.now(), user.totpLastStep);
  if (step === null) return false;
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return count === 1;
}

/** Marks a matching unused recovery code as used. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = hashRecoveryCode(code);
  if (!hash) return false;
  const { count } = await prisma.totpRecoveryCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/**
 * Second step of a password login. Call only after the password was
 * verified. "required" means the form should ask for a code.
 */
export async function verifySecondFactor(
  user: TwoFactorUser,
  code: string | undefined,
): Promise<SecondFactorResult> {
  if (!user.totpEnabledAt) return "ok";
  const input = code?.trim() ?? "";
  if (!input) return "required";
  const actor = { id: user.id, name: user.username };
  if (normalizeTotpCode(input) && (await consumeTotpCode(user, input))) return "ok";
  if (normalizeRecoveryCode(input) && (await consumeRecoveryCode(user.id, input))) {
    const left = await prisma.totpRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
    await audit({ action: "recoveryCode.used", actor, target: { type: "user", id: user.id, name: user.username }, details: { remaining: left } });
    return "ok";
  }
  await audit({ action: "2fa.failure", actor, target: { type: "user", id: user.id, name: user.username } });
  return "invalid";
}

/** Replaces all recovery codes and returns the new plain codes (shown once). */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    prisma.totpRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c)! })),
    }),
  ]);
  return codes;
}

/** Clears the whole two-factor setup (disable or admin reset). */
export async function clearTwoFactor(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    }),
  ]);
}
