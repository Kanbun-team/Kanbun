"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { safeAction } from "@/server/safe-action";
import { NOTIFICATION_TYPES, parsePrefs, serializePrefs } from "@/lib/notification-prefs";
import { emailEnabled } from "@/server/email";

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((v) => (v ? v : null))
  .pipe(z.email().nullable());

/**
 * Saves the "Notifications" section of the settings page: email address,
 * a channel per notification type (fields `pref_<type>`) and the digest.
 */
export async function updateNotificationSettingsAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const email = emailSchema.parse(String(formData.get("email") ?? ""));
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notificationPrefs: true, digestEnabled: true },
    });
    const stored = parsePrefs(current.notificationPrefs);
    // Without SMTP the email options are disabled inputs, which forms do not
    // submit: keep the stored email choices instead of silently dropping them.
    const mail = emailEnabled();
    const prefs: Record<string, unknown> = {};
    for (const type of NOTIFICATION_TYPES) {
      const v = formData.get(`pref_${type}`);
      prefs[type] = v ?? (!mail && stored[type] === "email" ? "email" : undefined);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        notificationPrefs: serializePrefs(prefs),
        digestEnabled: mail ? formData.get("digest") === "on" : current.digestEnabled,
      },
    });
    revalidatePath("/settings");
  });
}
