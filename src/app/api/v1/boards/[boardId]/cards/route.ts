import { apiRoute, created, pageParams, paginate, readJson } from "@/server/api/http";
import { createCard, listCards } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ boardId: string }>("read", async (ctx, req, { boardId }) => {
  const page = pageParams(req);
  return paginate(await listCards(ctx, boardId, req.nextUrl.searchParams, page), page);
});

export const POST = apiRoute<{ boardId: string }>("write", async (ctx, req, { boardId }) =>
  created(await createCard(ctx, boardId, await readJson(req)))
);
