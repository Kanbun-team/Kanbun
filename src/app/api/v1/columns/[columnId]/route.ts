import { apiRoute, readJson } from "@/server/api/http";
import { deleteColumn, updateColumn } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const PATCH = apiRoute<{ columnId: string }>("write", async (ctx, req, { columnId }) =>
  updateColumn(ctx, columnId, await readJson(req))
);

export const DELETE = apiRoute<{ columnId: string }>("write", (ctx, _req, { columnId }) => deleteColumn(ctx, columnId));
