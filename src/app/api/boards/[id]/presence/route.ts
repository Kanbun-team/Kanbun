import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db-local";
import { loadBoardAccess } from "@/server/board-access";
import { setPresenceCard } from "@/lib/presence";
import { isConnId } from "@/lib/presence-conn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  connId: z.string().refine(isConnId),
  cardId: z.string().min(1).max(64).nullable(),
});

// Tells the board which card this browser tab has open (or none). Keyed by the
// connection id the tab passed to its event stream.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // JSON only: a cross-site form cannot send it without a CORS preflight.
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return new Response("Unsupported Media Type", { status: 415 });
  }

  let access;
  try {
    access = await loadBoardAccess(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad Request", { status: 400 });
  const { connId, cardId } = parsed.data;

  if (cardId) {
    const card = await prisma.taskCard.findFirst({
      where: { id: cardId, column: { boardId: id } },
      select: { id: true },
    });
    if (!card) return new Response("Not Found", { status: 404 });
  }

  // An unknown connection (stream not open yet, or already closed) is not an
  // error: the client re-sends its card when the stream (re)opens.
  setPresenceCard(id, connId, access.userId, cardId);
  return new Response(null, { status: 204 });
}
