import { apiRoute } from "@/server/api/http";
import { listAutomations } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ boardId: string }>("read", (ctx, _req, { boardId }) => listAutomations(ctx, boardId));
