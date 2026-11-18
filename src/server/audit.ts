// Admin audit log. Server-only: call `audit()` after a security-relevant
// event succeeds. It never throws, so logging can not break the action.

import { headers } from "next/headers";
import { prisma } from "@/lib/db-local";
import { clientIp } from "@/lib/rate-limit";

/** Known actions. Add new ones here and give each an `audit_<action>` i18n key. */
export type AuditAction =
  | "login.success"
  | "login.failure"
  | "logout"
  | "user.create"
  | "user.role"
  | "user.deactivate"
  | "user.activate"
  | "user.passwordReset"
  | "user.delete"
  | "board.delete"
  | "board.restore"
  | "board.memberAdd"
  | "board.memberRemove"
  | "board.memberRole"
  | (string & {});

export interface AuditInput {
  action: AuditAction;
  actor?: { id: string; name?: string | null } | null;
  target?: { type: string; id?: string | null; name?: string | null } | null;
  details?: Record<string, unknown>;
  /** Pass when called outside a request (jobs); otherwise read from headers. */
  ip?: string | null;
}

async function requestIp(): Promise<string | null> {
  try {
    const ip = clientIp(await headers());
    return ip === "unknown" ? null : ip;
  } catch {
    return null; // not inside a request
  }
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? null,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        targetName: input.target?.name ?? null,
        details: JSON.stringify(input.details ?? {}),
        ip: input.ip !== undefined ? input.ip : await requestIp(),
      },
    });
  } catch (err) {
    console.error("[audit] failed to record", input.action, err);
  }
}
