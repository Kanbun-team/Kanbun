import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { audit } from "@/server/audit";
import { exportEverything } from "@/server/transfer/export";
import { downloadHeaders, fail } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full JSON export of every board, user and category: GET /api/admin/export.
// Admins only. No password hashes, sessions or attachment files.

export async function GET(req: NextRequest) {
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  if (user.role !== "admin") return fail("forbidden", 403);
  const activity = req.nextUrl.searchParams.get("activity") === "1";
  const data = await exportEverything({ activity });
  await audit({
    action: "export.full",
    actor: { id: user.id, name: user.username },
    target: { type: "instance" },
    details: { boards: data.boards.length, activity },
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: downloadHeaders(`kanbun-export-${data.exportedAt.slice(0, 10)}.json`, "application/json; charset=utf-8"),
  });
}
