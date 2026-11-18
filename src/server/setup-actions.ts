"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import type { DictKey } from "@/lib/i18n";
import { prisma } from "@/lib/db-local";
import { audit } from "@/server/audit";
import { createFirstAdmin, needsSetup, validateSetup } from "@/server/setup";

export type SetupState = { error?: DictKey; username?: string; displayName?: string };

/**
 * First-run setup: creates the admin account and signs it in. Does nothing
 * (sends the browser to the login page) once any account exists.
 */
export async function setupAdminAction(_: unknown, formData: FormData): Promise<SetupState> {
  if (!(await needsSetup())) redirect("/login");
  const result = validateSetup({
    username: String(formData.get("username") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  // Echo the non-secret fields back: React resets the form after the action.
  if (!result.ok) {
    return {
      error: result.error,
      username: String(formData.get("username") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
    };
  }
  const { username, displayName, password } = result.data;
  const created = await createFirstAdmin({ username, displayName, passwordHash: await bcrypt.hash(password, 12) });
  if (!created) redirect("/login");
  const admin = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (admin) {
    await audit({
      action: "user.create",
      actor: { id: admin.id, name: admin.username },
      target: { type: "user", id: admin.id, name: admin.username },
      details: { role: "admin", via: "setup" },
    });
  }
  // Throws the redirect to the next step on success.
  await signIn("credentials", { username, password, redirectTo: "/setup/board" });
  return {};
}
