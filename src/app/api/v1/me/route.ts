import { apiRoute } from "@/server/api/http";

export const dynamic = "force-dynamic";

export const GET = apiRoute("read", async (ctx) => ({
  id: ctx.user.id,
  username: ctx.user.username,
  displayName: ctx.user.displayName,
  role: ctx.user.role,
  token: {
    id: ctx.token.id,
    name: ctx.token.name,
    scope: ctx.token.scopes,
    expiresAt: ctx.token.expiresAt?.toISOString() ?? null,
  },
}));
