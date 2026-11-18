import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db-local";

// First-run detection. Kanbun starts with an empty database: until the first
// account exists, every page sends the browser to /setup, and /setup (and its
// action) refuse to do anything once an account exists.

export const PASSWORD_MIN_LENGTH = 6;

export async function needsSetup(db: PrismaClient = prisma): Promise<boolean> {
  return (await db.user.count()) === 0;
}

export type SetupInput = { username: string; displayName: string; password: string; confirm: string };
export type SetupError = "setupUsernameInvalid" | "setupPasswordShort" | "setupPasswordMismatch";

const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/;

/** Same rules as accounts created by an admin: 2 to 32 of a-z 0-9 _ . - */
export function validateSetup(input: SetupInput):
  | { ok: true; data: { username: string; displayName: string; password: string } }
  | { ok: false; error: SetupError } {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return { ok: false, error: "setupUsernameInvalid" };
  if (input.password.length < PASSWORD_MIN_LENGTH || input.password.length > 256) {
    return { ok: false, error: "setupPasswordShort" };
  }
  if (input.password !== input.confirm) return { ok: false, error: "setupPasswordMismatch" };
  const displayName = input.displayName.trim().slice(0, 64) || username;
  return { ok: true, data: { username, displayName, password: input.password } };
}

/**
 * Creates the first admin, but only while there are no users at all. The
 * check and the insert run in one transaction, so two browsers racing
 * through setup cannot both create an admin. Returns false when setup is
 * already done.
 */
export async function createFirstAdmin(
  data: { username: string; displayName: string; passwordHash: string },
  db: PrismaClient = prisma
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return false;
    await tx.user.create({
      data: { username: data.username, displayName: data.displayName, passwordHash: data.passwordHash, role: "admin" },
    });
    return true;
  });
}
