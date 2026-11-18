// Plumbing for the REST API route handlers under src/app/api/v1: bearer token
// authentication, per-token rate limiting, scope checks, JSON bodies,
// pagination and one error shape, `{ error: { code, message } }`.
//
// The API never looks at the session cookie: requests are authenticated by
// the Authorization header alone, so browsers can not be tricked into making
// authenticated cross-site calls (no CSRF), and no CORS headers are sent.

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { hashToken, parseBearer, scopeAllows, tokenState, type TokenScope } from "@/lib/api-tokens";
import { getLimiter } from "@/lib/limiter";
import { clientIp } from "@/lib/rate-limit";
import { readTextLimited } from "@/server/transfer/http";

export interface ApiUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

export interface ApiContext {
  user: ApiUser;
  token: { id: string; name: string; scopes: string; expiresAt: Date | null };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);

const RATE_WINDOW_MS = 60_000;
/** Requests per token per minute; API_RATE_LIMIT overrides it. */
export function rateLimitPerMinute(): number {
  const n = Number(process.env.API_RATE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 120;
}
/** Failed authentications per client IP per minute before answering 429. */
const AUTH_FAILURES_PER_MINUTE = 60;
const MAX_BODY_BYTES = 1_000_000;
/** lastUsedAt is written at most this often per token. */
const TOUCH_EVERY_MS = 60_000;

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra?: { details?: unknown; headers?: Record<string, string> }
): Response {
  return Response.json(
    { error: { code, message, ...(extra?.details !== undefined ? { details: extra.details } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...extra?.headers } }
  );
}

function toErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, { details: err.details });
  if (err instanceof ZodError) {
    return errorResponse(422, "validation_failed", "The request body or query is not valid.", {
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof ActionError) {
    switch (err.code) {
      case "unauthorized":
        return errorResponse(401, "unauthorized", "Authentication required.");
      case "forbidden":
        return errorResponse(403, "forbidden", "You do not have access to this resource.");
      case "notFound":
        return errorResponse(404, "not_found", "Resource not found.");
      default:
        return errorResponse(422, "validation_failed", `The request can not be processed (${err.code}).`);
    }
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return errorResponse(404, "not_found", "Resource not found.");
  }
  console.error("[api]", err);
  return errorResponse(500, "internal_error", "Something went wrong.");
}

const unauthorized = (message: string) =>
  errorResponse(401, "unauthorized", message, { headers: { "WWW-Authenticate": 'Bearer realm="kanbun"' } });

async function authenticate(req: NextRequest): Promise<ApiContext | Response> {
  const raw = parseBearer(req.headers.get("authorization"));
  const fail = async (message: string) => {
    const ip = clientIp(req.headers);
    const limited = await getLimiter().hit(`api-auth-fail:${ip}`, AUTH_FAILURES_PER_MINUTE, RATE_WINDOW_MS);
    if (!limited.allowed) {
      const retry = Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000));
      return errorResponse(429, "rate_limited", "Too many failed attempts. Try again later.", {
        headers: { "Retry-After": String(retry) },
      });
    }
    return unauthorized(message);
  };
  if (!raw) return fail("Missing or malformed bearer token.");

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      user: { select: { id: true, username: true, displayName: true, role: true, deactivatedAt: true } },
    },
  });
  if (!token || tokenState(token) !== "active" || token.user.deactivatedAt) {
    return fail("The token is invalid, expired or revoked.");
  }

  const now = Date.now();
  if (!token.lastUsedAt || now - token.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => undefined);
  }
  const { deactivatedAt: _deactivated, ...user } = token.user;
  void _deactivated;
  return { user, token: { id: token.id, name: token.name, scopes: token.scopes, expiresAt: token.expiresAt } };
}

type Handler<P> = (ctx: ApiContext, req: NextRequest, params: P) => Promise<unknown>;

/**
 * Wraps a route handler: authenticates the token, applies the rate limit,
 * requires `scope`, and turns the returned value into JSON (a returned
 * Response passes through) and thrown errors into the error shape.
 */
export function apiRoute<P = Record<string, never>>(scope: TokenScope, handler: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }): Promise<Response> => {
    let rateHeaders: Record<string, string> = {};
    try {
      const auth = await authenticate(req);
      if (auth instanceof Response) return auth;

      const limit = await getLimiter().hit(`api:${auth.token.id}`, rateLimitPerMinute(), RATE_WINDOW_MS);
      rateHeaders = {
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
      };
      if (!limit.allowed) {
        const retry = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
        return errorResponse(429, "rate_limited", "Rate limit exceeded. Try again later.", {
          headers: { ...rateHeaders, "Retry-After": String(retry) },
        });
      }
      if (!scopeAllows(auth.token.scopes, scope)) {
        return errorResponse(403, "insufficient_scope", `This operation needs a token with the "${scope}" scope.`, {
          headers: rateHeaders,
        });
      }

      const result = await handler(auth, req, await route.params);
      const res = result instanceof Response ? result : Response.json(result);
      for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      const res = toErrorResponse(err);
      for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
      return res;
    }
  };
}

/** Parses a JSON object body (400 when it is not JSON, 413 when too large). */
export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  // Read with a cap, so an oversized body is refused without holding it in memory.
  const text = await readTextLimited(req, MAX_BODY_BYTES);
  if (text === null) throw new ApiError(413, "payload_too_large", "The body is too large.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_request", "The body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "bad_request", "The body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export const created = (data: unknown) => Response.json(data, { status: 201 });
export const noContent = () => new Response(null, { status: 204 });

// ---------------------------------------------------------------------------
// Pagination: `?limit=` (1 to 100, default 50) and an opaque `?cursor=` taken
// from the `next` field of the previous page.
// ---------------------------------------------------------------------------

export interface PageParams {
  take: number;
  skip: number;
}

export function pageParams(req: NextRequest): PageParams {
  const sp = req.nextUrl.searchParams;
  const rawLimit = sp.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(422, "validation_failed", "limit must be an integer from 1 to 100.");
  }
  const cursor = sp.get("cursor");
  let skip = 0;
  if (cursor) {
    const decoded = Number(Buffer.from(cursor, "base64url").toString("utf8").replace(/^o:/, ""));
    if (!Number.isInteger(decoded) || decoded < 0) throw new ApiError(422, "validation_failed", "cursor is not valid.");
    skip = decoded;
  }
  return { take: limit, skip };
}

/** Pass rows fetched with `take: page.take + 1`; returns the page body. */
export function paginate<T>(rows: T[], page: PageParams): { data: T[]; next: string | null } {
  const more = rows.length > page.take;
  return {
    data: more ? rows.slice(0, page.take) : rows,
    next: more ? Buffer.from(`o:${page.skip + page.take}`, "utf8").toString("base64url") : null,
  };
}
