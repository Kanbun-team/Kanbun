import { prisma } from "@/lib/db-local";

// Drops audit log entries older than AUDIT_RETENTION_DAYS (default 365).
// 0 keeps every entry forever.

export function auditRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AUDIT_RETENTION_DAYS?.trim();
  if (!raw) return 365;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : 365;
}

export async function runAuditPurge(now: Date = new Date()): Promise<number> {
  const days = auditRetentionDays();
  if (days === 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
