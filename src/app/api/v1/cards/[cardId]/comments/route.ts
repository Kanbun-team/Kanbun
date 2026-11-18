import { apiRoute, created, pageParams, paginate, readJson } from "@/server/api/http";
import { addComment, listComments } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ cardId: string }>("read", async (ctx, req, { cardId }) => {
  const page = pageParams(req);
  return paginate(await listComments(ctx, cardId, page), page);
});

export const POST = apiRoute<{ cardId: string }>("write", async (ctx, req, { cardId }) =>
  created(await addComment(ctx, cardId, await readJson(req)))
);
