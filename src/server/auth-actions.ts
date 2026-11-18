"use server";

import { auth, signIn, signOut } from "@/auth";
import { audit } from "@/server/audit";
import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/utils";
import { SSO_PROVIDER_ID, ssoConfig } from "@/lib/sso";
import { clearLinkIntent } from "@/server/sso";

export type LoginState = {
  error?: string;
  /** "code" when the password was accepted and a two-factor code is needed. */
  step?: "code";
};

export async function loginAction(_: unknown, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const from = safeRedirect(String(formData.get("from") ?? ""), "/tasks");
  if (!username || !password) {
    return { error: "Invalid username or password." };
  }
  try {
    await signIn("credentials", {
      username,
      password,
      ...(code ? { code } : {}),
      redirectTo: from,
    });
  } catch (err) {
    if (err instanceof CredentialsSignin && err.code === "totp_required") {
      return { step: "code" };
    }
    if (err instanceof CredentialsSignin && err.code === "totp_invalid") {
      return { step: "code", error: "That code is not valid. Check your authenticator app and try again." };
    }
    if (err instanceof AuthError) {
      // A rate-limited or wrong login on the code step goes back to the start.
      return { error: "Invalid username or password." };
    }
    throw err;
  }
  return {};
}

export async function ssoLoginAction(formData: FormData): Promise<void> {
  if (!ssoConfig()) redirect("/login");
  const from = safeRedirect(String(formData.get("from") ?? ""), "/tasks");
  // A stale link request from an earlier session must not attach this login to it.
  await clearLinkIntent();
  await signIn(SSO_PROVIDER_ID, { redirectTo: from });
}

export async function logoutAction() {
  const session = await auth().catch(() => null);
  const user = session?.user;
  if (user?.id) {
    await audit({
      action: "logout",
      actor: { id: user.id, name: user.username },
      target: { type: "user", id: user.id, name: user.username },
    });
  }
  await clearLinkIntent();
  await signOut({ redirect: false });
  redirect("/login");
}
