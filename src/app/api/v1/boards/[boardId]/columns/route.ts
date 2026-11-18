import { apiRoute, created, readJson } from "@/server/api/http";
import { createColumn, listColumns } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ boardId: string }>("read", (ctx, _req, { boardId }) => listColumns(ctx, boardId));

export const POST = apiRoute<{ boardId: string }>("write", async (ctx, req, { boardId }) =>
  created(await createColumn(ctx, boardId, await readJson(req)))
);
