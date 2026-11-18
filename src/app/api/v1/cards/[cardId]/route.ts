import { apiRoute, readJson } from "@/server/api/http";
import { deleteCard, getCard, updateCard } from "@/server/api/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ cardId: string }>("read", (ctx, _req, { cardId }) => getCard(ctx, cardId));

export const PATCH = apiRoute<{ cardId: string }>("write", async (ctx, req, { cardId }) =>
  updateCard(ctx, cardId, await readJson(req))
);

export const DELETE = apiRoute<{ cardId: string }>("write", (ctx, _req, { cardId }) => deleteCard(ctx, cardId));
