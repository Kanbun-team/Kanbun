// Personal access tokens for the REST API. Pure helpers (no database), so they
// can be unit tested: format, hashing, parsing the Authorization header.
//
// A token is `kbn_` followed by 64 hex characters (32 random bytes). Only its
// SHA-256 hash is stored, so a database leak does not leak usable tokens.

import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "kbn_";
const TOKEN_RE = /^kbn_[0-9a-f]{64}$/;
/** Characters of the token kept in clear text so the UI can tell tokens apart. */
const VISIBLE_CHARS = TOKEN_PREFIX.length + 8;

export const TOKEN_SCOPES = ["read", "write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Expiry choices offered in settings, in days; 0 means never. */
export const TOKEN_EXPIRY_DAYS = [0, 30, 90, 365] as const;

/** Active tokens a single user may hold. */
export const MAX_TOKENS_PER_USER = 25;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, VISIBLE_CHARS);
}

export function isTokenFormat(value: string): boolean {
  return TOKEN_RE.test(value);
}

/**
 * The token from an `Authorization: Bearer <token>` header, or null when the
 * header is missing, uses another scheme or does not hold a Kanbun token.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  if (!match) return null;
  return isTokenFormat(match[1]) ? match[1] : null;
}

/** Whether a token with `granted` scope may perform an operation needing `needed`. */
export function scopeAllows(granted: string, needed: TokenScope): boolean {
  if (needed === "read") return granted === "read" || granted === "write";
  return granted === "write";
}

export function expiryDate(days: number, now: Date = new Date()): Date | null {
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export type TokenState = "active" | "expired" | "revoked";

export function tokenState(token: { revokedAt: Date | null; expiresAt: Date | null }, now: Date = new Date()): TokenState {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
