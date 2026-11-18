import { apiRoute, pageParams, paginate } from "@/server/api/http";
import { listBoards } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute("read", async (ctx, req) => {
  const page = pageParams(req);
  return paginate(await listBoards(ctx, page), page);
});
