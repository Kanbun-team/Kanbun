import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db-local";
import { loadBoardAccess } from "@/server/board-access";
import { subscribeBoard, type BoardEvent } from "@/lib/realtime";
import { joinPresence, type PresenceViewer } from "@/lib/presence";
import { isConnId } from "@/lib/presence-conn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Only members (or admins) of the board may listen to its event stream.
  let access;
  try {
    access = await loadBoardAccess(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  // The client names its connection so it can later say which card it has
  // open (POST /api/boards/[id]/presence). Without one, the stream still
  // works but the viewer never shows a card.
  const rawConn = req.nextUrl.searchParams.get("conn");
  const connId = rawConn && isConnId(rawConn) ? rawConn : crypto.randomUUID();
  const user = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { username: true, displayName: true, avatarUrl: true },
  });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let leavePresence: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client is gone: drop its presence too.
          cleanup();
        }
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        leavePresence?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Ask the browser to reconnect quickly, then open the stream.
      send("retry: 3000\n\n");
      send(": connected\n\n");

      unsubscribe = subscribeBoard(id, (event: BoardEvent) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      if (user) {
        leavePresence = joinPresence(id, {
          connId,
          userId: access.userId,
          name: user.displayName || user.username,
          avatarUrl: user.avatarUrl,
          cardId: null,
          notify: (viewers: PresenceViewer[]) => {
            send(`event: presence\ndata: ${JSON.stringify({ viewers })}\n\n`);
          },
        });
      }

      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      if (req.signal.aborted) cleanup();
      else req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
