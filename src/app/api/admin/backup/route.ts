import { auth } from "@/auth";
import { audit } from "@/server/audit";
import { createBackup, isSqliteUrl } from "@/server/backup";
import { downloadHeaders, fail } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-click backup: GET /api/admin/backup streams a .tar.gz with a consistent
// SQLite snapshot and the attachments folder. Admins only. With another
// database engine the operator backs up with that engine's tools instead.

export async function GET() {
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  if (user.role !== "admin") return fail("forbidden", 403);
  if (!isSqliteUrl()) return fail("backupUnsupported", 501);

  let backup;
  try {
    backup = await createBackup();
  } catch (err) {
    console.error("[backup]", err);
    return fail("unknown", 500);
  }
  await audit({
    action: "backup.download",
    actor: { id: user.id, name: user.username },
    target: { type: "instance" },
    details: { file: backup.fileName },
  });
  return new Response(backup.stream, { headers: downloadHeaders(backup.fileName, "application/gzip") });
}
