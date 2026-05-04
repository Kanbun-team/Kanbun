"use server";

import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/utils";

export async function loginAction(
  _: unknown,
  formData: FormData
): Promise<{ error?: string }> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const from = safeRedirect(String(formData.get("from") ?? ""), "/tasks");
  if (!username || !password) {
    return { error: "Invalid username or password." };
  }
  try {
    await signIn("credentials", {
      username,
      password,
      redirectTo: from,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Invalid username or password." };
    }
    throw err;
  }
  return {};
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}
