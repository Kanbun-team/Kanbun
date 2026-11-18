"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db-local";
import { auth, refreshSession, requireRole, requireUser } from "@/auth";
import { isLocale } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/get-locale";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/server/audit";

type SessionUser = { id: string; username: string };
const actorOf = (u: SessionUser) => ({ id: u.id, name: u.username });

async function tryRefreshSession(patch: Record<string, unknown>): Promise<void> {
  try {
    await refreshSession({ user: patch } as never);
  } catch (err) {
    console.warn("[auth] refreshSession failed, session will sync on next login:", err);
  }
}

const themeSchema = z.enum(["light", "dark", "system"]);
const localeSchema = z.enum(["en", "it", "pl", "de"]);

export async function setThemeAction(theme: string) {
  return safeAction(async () => {
    const parsed = themeSchema.parse(theme);
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { themePreference: parsed },
    });
    const cookieStore = await cookies();
    cookieStore.set("kanbun_theme", parsed, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    await tryRefreshSession({ themePreference: parsed });
    revalidatePath("/");
  });
}

export async function setLocaleAction(locale: string) {
  return safeAction(async () => {
    const parsed = localeSchema.parse(locale);
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { locale: parsed },
    });
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, parsed, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    await tryRefreshSession({ locale: parsed });
    revalidatePath("/");
  });
}

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function updateProfileAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = profileSchema.parse({
      displayName: formData.get("displayName"),
      avatarUrl: formData.get("avatarUrl") ?? "",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { displayName: data.displayName, avatarUrl: data.avatarUrl },
    });
    await tryRefreshSession({
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
    });
    revalidatePath("/settings");
    revalidatePath("/");
  });
}

const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9_.-]+$/i, "Invalid username"),
  password: z.string().min(6).max(256),
  displayName: z.string().trim().max(64).optional().nullable(),
  role: z.enum(["member", "admin"]),
});

export async function adminCreateUserAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireRole("admin");
    const data = userCreateSchema.parse({
      username: formData.get("username"),
      password: formData.get("password"),
      displayName: formData.get("displayName") || null,
      role: formData.get("role") || "member",
    });
    const taken = await prisma.user.findUnique({
      where: { username: data.username.toLowerCase() },
      select: { id: true },
    });
    if (taken) throw new ActionError("usernameTaken");
    const passwordHash = await bcrypt.hash(data.password, 12);
    const created = await prisma.user.create({
      data: {
        username: data.username.toLowerCase(),
        passwordHash,
        displayName: data.displayName ?? data.username,
        role: data.role,
      },
    });
    await audit({
      action: "user.create",
      actor: actorOf(me),
      target: { type: "user", id: created.id, name: created.username },
      details: { role: created.role },
    });
    revalidatePath("/admin/users");
  });
}

const userUpdateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["member", "admin"]),
  displayName: z.string().trim().max(64).optional().nullable(),
});

export async function adminUpdateUserAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireRole("admin");
    const data = userUpdateSchema.parse({
      userId: formData.get("userId"),
      role: formData.get("role"),
      displayName: formData.get("displayName") || null,
    });
    const before = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { role: true },
    });
    if (!before) throw new ActionError("userNotFound");
    // Admins can not change their own role (the UI locks it too), so the
    // last admin can never demote themselves by accident.
    const role = data.userId === me.id ? before.role : data.role;
    const updated = await prisma.user.update({
      where: { id: data.userId },
      data: {
        role,
        displayName: data.displayName ?? undefined,
      },
    });
    if (before.role !== updated.role) {
      await audit({
        action: "user.role",
        actor: actorOf(me),
        target: { type: "user", id: updated.id, name: updated.username },
        details: { from: before.role, to: updated.role },
      });
    }
    revalidatePath("/admin/users");
  });
}

const userResetSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(6).max(256),
});

export async function adminResetPasswordAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireRole("admin");
    const data = userResetSchema.parse({
      userId: formData.get("userId"),
      password: formData.get("password"),
    });
    const passwordHash = await bcrypt.hash(data.password, 12);
    const target = await prisma.user.update({
      where: { id: data.userId },
      // Bumping sessionVersion signs the user out everywhere.
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    // A reset usually means the account may be compromised: revoke its API tokens too.
    const revoked = await prisma.apiToken.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({
      action: "user.passwordReset",
      actor: actorOf(me),
      target: { type: "user", id: target.id, name: target.username },
      details: { tokensRevoked: revoked.count },
    });
    revalidatePath("/admin/users");
  });
}

export async function adminDeleteUserAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireRole("admin");
    const userId = String(formData.get("userId") ?? "");
    if (!userId) throw new ActionError("invalid");
    if (userId === me.id) throw new ActionError("selfAction");
    const deleted = await prisma.user.delete({ where: { id: userId } });
    await audit({
      action: "user.delete",
      actor: actorOf(me),
      target: { type: "user", id: deleted.id, name: deleted.username },
      details: { role: deleted.role },
    });
    revalidatePath("/admin/users");
  });
}

// Deactivated users cannot sign in (their sessions end on the next request)
// and disappear from pickers, but their cards, comments and history stay.
export async function adminSetUserActiveAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireRole("admin");
    const userId = String(formData.get("userId") ?? "");
    const active = formData.get("active") === "true";
    if (!userId) throw new ActionError("invalid");
    if (userId === me.id) throw new ActionError("selfAction");
    const target = await prisma.user.update({
      where: { id: userId },
      data: active
        ? { deactivatedAt: null }
        : { deactivatedAt: new Date(), sessionVersion: { increment: 1 } },
    });
    await audit({
      action: active ? "user.activate" : "user.deactivate",
      actor: actorOf(me),
      target: { type: "user", id: target.id, name: target.username },
    });
    revalidatePath("/admin/users");
  });
}

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export { isLocale };
