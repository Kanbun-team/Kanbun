import { auth } from "@/auth";
import { ActionError } from "@/lib/action-result";
import { loadBoardAccess } from "@/server/board-access";
import { loadOfflineBoardCards } from "@/server/offline-cards";
import { fail, statusOf } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight details of every card of a board, fetched in the background by
// the board page and stored in IndexedDB for reading cards offline (see
// docs/OFFLINE.md). Board members only. Never cached: the service worker
// skips /api/*, and the response says no-store.

const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  try {
    await loadBoardAccess(id);
  } catch (err) {
    const code = err instanceof ActionError ? err.code : "unknown";
    // Same answer for a board that does not exist and one the user can not open.
    return code === "forbidden" ? fail("notFound", 404) : fail(code, statusOf(code));
  }
  const data = await loadOfflineBoardCards(id);
  if (!data) return fail("notFound", 404);
  return Response.json(data, { headers: NO_STORE });
}
