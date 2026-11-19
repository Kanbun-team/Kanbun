import { apiRoute, created, pageParams, paginate, readJson } from "@/server/api/http";
import { addComment, listComments } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ cardId: string }>("read", async (ctx, req, { cardId }) => {
  const page = pageParams(req);
  return paginate(await listComments(ctx, cardId, page), page);
});

// With an Idempotency-Key header, a repeated request answers 200 with the
// comment the first request created (201) instead of adding another one.
export const POST = apiRoute<{ cardId: string }>("write", async (ctx, req, { cardId }) => {
  const result = await addComment(ctx, cardId, await readJson(req), req.headers.get("idempotency-key"));
  return result.created ? created(result.comment) : Response.json(result.comment);
});
