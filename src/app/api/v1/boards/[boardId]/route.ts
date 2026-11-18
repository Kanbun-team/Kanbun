import { apiRoute } from "@/server/api/http";
import { getBoard } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ boardId: string }>("read", (ctx, _req, { boardId }) => getBoard(ctx, boardId));
