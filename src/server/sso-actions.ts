"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, signIn } from "@/auth";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { hasUsablePassword } from "@/lib/password";
import { SSO_PROVIDER_ID, passwordLoginAllowed, ssoConfig } from "@/lib/sso";
import { safeAction } from "@/server/safe-action";
import { audit } from "@/server/audit";
import { setLinkIntent } from "@/server/sso";

/** Settings: sends the signed-in user to the IdP to link their account. */
export async function startSsoLinkAction(): Promise<void> {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (!ssoConfig()) redirect("/settings");
  await setLinkIntent(user.id);
  await signIn(SSO_PROVIDER_ID, { redirectTo: "/settings" });
}

/** Settings: removes the linked SSO account, if the user can still sign in without it. */
export async function unlinkSsoAction() {
  return safeAction(async () => {
    const me = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        username: true,
        role: true,
        passwordHash: true,
        identities: { where: { provider: SSO_PROVIDER_ID }, select: { id: true, subject: true } },
      },
    });
    if (!user) throw new ActionError("unauthorized");
    const identity = user.identities[0];
    if (!identity) throw new ActionError("notFound");
    const canUsePassword = hasUsablePassword(user.passwordHash) && passwordLoginAllowed(user.role, ssoConfig());
    if (!canUsePassword) throw new ActionError("lastSignInMethod");
    await prisma.userIdentity.delete({ where: { id: identity.id } });
    await audit({
      action: "sso.unlink",
      actor: { id: user.id, name: user.username },
      target: { type: "user", id: user.id, name: user.username },
      details: { subject: identity.subject },
    });
    revalidatePath("/settings");
    revalidatePath("/admin/users");
  });
}
