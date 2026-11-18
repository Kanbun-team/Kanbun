"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/auth";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { clientIp, isLoginBlocked, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { hasUsablePassword } from "@/lib/password";
import { encryptSecret } from "@/lib/secret-box";
import { generateTotpSecret, normalizeTotpCode } from "@/lib/totp";
import { safeAction } from "@/server/safe-action";
import { audit } from "@/server/audit";
import { clearTwoFactor, consumeRecoveryCode, consumeTotpCode, replaceRecoveryCodes } from "@/server/two-factor";

async function loadUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, passwordHash: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true },
  });
  if (!user) throw new ActionError("unauthorized");
  return user;
}

/**
 * Re-authentication for sensitive changes: a current code, a recovery code or
 * the password. Failures count in the login rate limiter.
 */
async function verifyCurrentFactor(user: Awaited<ReturnType<typeof loadUser>>, input: string): Promise<void> {
  const ip = clientIp(await headers());
  if (isLoginBlocked(ip, user.username)) throw new ActionError("tooManyAttempts");
  const value = input.trim();
  let ok = false;
  if (value && normalizeTotpCode(value)) ok = await consumeTotpCode(user, value);
  if (!ok && value) ok = await consumeRecoveryCode(user.id, value);
  if (!ok && value && hasUsablePassword(user.passwordHash)) ok = await bcrypt.compare(value, user.passwordHash);
  if (!ok) {
    recordLoginFailure(ip, user.username);
    await audit({ action: "2fa.failure", actor: { id: user.id, name: user.username }, target: { type: "user", id: user.id, name: user.username } });
    throw new ActionError("invalidCode");
  }
  recordLoginSuccess(ip, user.username);
}

/** Starts (or restarts) setup: stores a new, not yet enabled secret. */
export async function startTotpSetupAction() {
  return safeAction(async () => {
    const me = await requireUser();
    const user = await loadUser(me.id);
    if (!hasUsablePassword(user.passwordHash)) throw new ActionError("forbidden");
    if (user.totpEnabledAt) throw new ActionError("invalid");
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(generateTotpSecret()), totpLastStep: null },
    });
    revalidatePath("/settings");
  });
}

export async function cancelTotpSetupAction() {
  return safeAction(async () => {
    const me = await requireUser();
    await prisma.user.updateMany({
      where: { id: me.id, totpEnabledAt: null },
      data: { totpSecret: null, totpLastStep: null },
    });
    revalidatePath("/settings");
  });
}

/** Confirms setup with a code from the app; returns the recovery codes to show once. */
export async function confirmTotpSetupAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireUser();
    const user = await loadUser(me.id);
    if (user.totpEnabledAt || !user.totpSecret) throw new ActionError("invalid");
    const ip = clientIp(await headers());
    if (isLoginBlocked(ip, user.username)) throw new ActionError("tooManyAttempts");
    const code = String(formData.get("code") ?? "");
    if (!(await consumeTotpCode(user, code))) {
      recordLoginFailure(ip, user.username);
      throw new ActionError("invalidCode");
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    const codes = await replaceRecoveryCodes(user.id);
    await audit({ action: "2fa.enable", actor: { id: user.id, name: user.username }, target: { type: "user", id: user.id, name: user.username } });
    revalidatePath("/settings");
    revalidatePath("/admin/users");
    return { codes };
  });
}

export async function disableTotpAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireUser();
    const user = await loadUser(me.id);
    if (!user.totpEnabledAt) throw new ActionError("invalid");
    await verifyCurrentFactor(user, String(formData.get("credential") ?? ""));
    await clearTwoFactor(user.id);
    await audit({ action: "2fa.disable", actor: { id: user.id, name: user.username }, target: { type: "user", id: user.id, name: user.username } });
    revalidatePath("/settings");
    revalidatePath("/admin/users");
  });
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireUser();
    const user = await loadUser(me.id);
    if (!user.totpEnabledAt) throw new ActionError("invalid");
    await verifyCurrentFactor(user, String(formData.get("credential") ?? ""));
    const codes = await replaceRecoveryCodes(user.id);
    await audit({ action: "2fa.recoveryCodes", actor: { id: user.id, name: user.username }, target: { type: "user", id: user.id, name: user.username } });
    revalidatePath("/settings");
    return { codes };
  });
}

/** Admin: removes a user's two-factor setup, e.g. after a lost phone. */
export async function adminResetTwoFactorAction(formData: FormData) {
  return safeAction(async () => {
    const admin = await requireRole("admin");
    const userId = String(formData.get("userId") ?? "");
    if (!userId) throw new ActionError("invalid");
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, totpSecret: true } });
    if (!target) throw new ActionError("notFound");
    await clearTwoFactor(target.id);
    await audit({
      action: "2fa.reset",
      actor: { id: admin.id, name: admin.username },
      target: { type: "user", id: target.id, name: target.username },
    });
    revalidatePath("/admin/users");
  });
}
