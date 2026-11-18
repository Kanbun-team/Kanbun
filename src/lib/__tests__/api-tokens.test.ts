import { describe, expect, it } from "vitest";
import {
  expiryDate,
  generateToken,
  hashToken,
  isTokenFormat,
  parseBearer,
  scopeAllows,
  tokenPrefix,
  tokenState,
} from "@/lib/api-tokens";

describe("api tokens", () => {
  it("generates unique kbn_ tokens with 64 hex characters", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^kbn_[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(isTokenFormat(a)).toBe(true);
  });

  it("hashes with sha256 (stable, hex, not the token itself)", () => {
    const token = "kbn_" + "a".repeat(64);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    // Known vector: sha256("abc").
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("keeps a short visible prefix", () => {
    const token = generateToken();
    expect(tokenPrefix(token)).toBe(token.slice(0, 12));
    expect(tokenPrefix(token).startsWith("kbn_")).toBe(true);
  });

  it("parses bearer headers", () => {
    const token = generateToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer   ${token}  `)).toBe(token);
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer(`Basic ${token}`)).toBeNull();
    expect(parseBearer(`Bearer ${token} extra`)).toBeNull();
    expect(parseBearer("Bearer kbn_short")).toBeNull();
    expect(parseBearer(`Bearer ${token.toUpperCase()}`)).toBeNull();
  });

  it("write includes read, read does not include write", () => {
    expect(scopeAllows("read", "read")).toBe(true);
    expect(scopeAllows("write", "read")).toBe(true);
    expect(scopeAllows("write", "write")).toBe(true);
    expect(scopeAllows("read", "write")).toBe(false);
    expect(scopeAllows("", "read")).toBe(false);
  });

  it("computes expiry and state", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(expiryDate(0, now)).toBeNull();
    expect(expiryDate(30, now)?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(tokenState({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(tokenState({ revokedAt: null, expiresAt: new Date("2026-01-02") }, now)).toBe("active");
    expect(tokenState({ revokedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(tokenState({ revokedAt: now, expiresAt: null }, now)).toBe("revoked");
  });
});
