"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import { safeAction } from "@/server/safe-action";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/server/audit";
import {
  MAX_TOKENS_PER_USER,
  TOKEN_EXPIRY_DAYS,
  TOKEN_SCOPES,
  expiryDate,
  generateToken,
  hashToken,
  tokenPrefix,
} from "@/lib/api-tokens";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(TOKEN_SCOPES),
  expiresInDays: z.coerce
    .number()
    .int()
    .refine((n) => (TOKEN_EXPIRY_DAYS as readonly number[]).includes(n)),
});

/** Creates a personal access token. The token itself is returned only here. */
export async function createApiTokenAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = createSchema.parse({
      name: formData.get("name"),
      scope: formData.get("scope"),
      expiresInDays: formData.get("expiresInDays"),
    });
    const now = new Date();
    const active = await prisma.apiToken.count({
      where: { userId: user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (active >= MAX_TOKENS_PER_USER) throw new ActionError("limitReached");
    const token = generateToken();
    const row = await prisma.apiToken.create({
      data: {
        userId: user.id,
        name: data.name,
        tokenHash: hashToken(token),
        prefix: tokenPrefix(token),
        scopes: data.scope,
        expiresAt: expiryDate(data.expiresInDays, now),
      },
      select: { id: true, name: true },
    });
    await audit({
      action: "token.create",
      actor: { id: user.id, name: user.username },
      target: { type: "token", id: row.id, name: row.name },
      details: { scope: data.scope, expiresInDays: data.expiresInDays },
    });
    revalidatePath("/settings");
    return { id: row.id, token };
  });
}

export async function revokeApiTokenAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const id = z.string().min(1).parse(formData.get("tokenId"));
    const token = await prisma.apiToken.findUnique({ where: { id }, select: { userId: true, name: true, revokedAt: true } });
    if (!token || token.userId !== user.id) throw new ActionError("notFound");
    if (!token.revokedAt) {
      await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit({
        action: "token.revoke",
        actor: { id: user.id, name: user.username },
        target: { type: "token", id, name: token.name },
      });
    }
    revalidatePath("/settings");
  });
}
