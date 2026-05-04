"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db-local";
import { auth, refreshSession, requireRole, requireUser } from "@/auth";
import { isLocale } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/get-locale";

async function tryRefreshSession(patch: Record<string, unknown>): Promise<void> {
  try {
    await refreshSession({ user: patch } as never);
  } catch (err) {
    console.warn("[auth] refreshSession failed, session will sync on next login:", err);
  }
}

const themeSchema = z.enum(["light", "dark", "system"]);
const localeSchema = z.enum(["en", "pl"]);

export async function setThemeAction(theme: string) {
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
}

export async function setLocaleAction(locale: string) {
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
  role: z.enum(["support", "dev", "mod", "admin"]),
  accessTasks: z.coerce.boolean(),
});

export async function adminCreateUserAction(formData: FormData) {
  await requireRole("admin");
  const data = userCreateSchema.parse({
    username: formData.get("username"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || null,
    role: formData.get("role") || "support",
    accessTasks: formData.get("accessTasks") === "on" || formData.get("accessTasks") === "true",
  });
  const passwordHash = await bcrypt.hash(data.password, 12);
  await prisma.user.create({
    data: {
      username: data.username.toLowerCase(),
      passwordHash,
      displayName: data.displayName ?? data.username,
      role: data.role,
      accessTasks: data.accessTasks,
    },
  });
  revalidatePath("/admin/users");
}

const userUpdateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["support", "dev", "mod", "admin"]),
  accessTasks: z.coerce.boolean(),
  displayName: z.string().trim().max(64).optional().nullable(),
});

export async function adminUpdateUserAction(formData: FormData) {
  await requireRole("admin");
  const data = userUpdateSchema.parse({
    userId: formData.get("userId"),
    role: formData.get("role"),
    accessTasks: formData.get("accessTasks") === "on" || formData.get("accessTasks") === "true",
    displayName: formData.get("displayName") || null,
  });
  await prisma.user.update({
    where: { id: data.userId },
    data: {
      role: data.role,
      accessTasks: data.accessTasks,
      displayName: data.displayName ?? undefined,
    },
  });
  revalidatePath("/admin/users");
}

const userResetSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(6).max(256),
});

export async function adminResetPasswordAction(formData: FormData) {
  await requireRole("admin");
  const data = userResetSchema.parse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  const passwordHash = await bcrypt.hash(data.password, 12);
  await prisma.user.update({
    where: { id: data.userId },
    data: { passwordHash },
  });
  revalidatePath("/admin/users");
}

export async function adminDeleteUserAction(formData: FormData) {
  const me = await requireRole("admin");
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Invalid input");
  if (userId === me.id) throw new Error("You cannot delete yourself.");
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
}

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export { isLocale };
