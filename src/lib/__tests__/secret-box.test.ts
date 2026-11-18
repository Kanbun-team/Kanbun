import { describe, expect, it } from "vitest";
import { decryptSecret, deriveKey, encryptSecret, keyedHash } from "@/lib/secret-box";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/recovery-codes";

const KEY = "test-auth-secret-with-enough-length";

describe("secret box (AES-256-GCM, HKDF key)", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", KEY);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored, KEY)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("returns null with another AUTH_SECRET", () => {
    expect(decryptSecret(encryptSecret("x", KEY), "another-secret")).toBeNull();
  });

  it("returns null when tampered with or malformed", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", KEY);
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(decryptSecret(`v1:${raw.toString("base64")}`, KEY)).toBeNull();
    expect(decryptSecret("v2:abc", KEY)).toBeNull();
    expect(decryptSecret("garbage", KEY)).toBeNull();
    expect(decryptSecret("v1:", KEY)).toBeNull();
  });

  it("derives different keys per purpose", () => {
    expect(deriveKey("a", KEY).equals(deriveKey("b", KEY))).toBe(false);
    expect(deriveKey("a", KEY)).toHaveLength(32);
    expect(keyedHash("v", "a", KEY)).not.toBe(keyedHash("v", "b", KEY));
  });
});

describe("recovery codes", () => {
  it("generates ten distinct codes in xxxx-xxxx-xxxx form", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
  });

  it("normalizes case, spaces and dashes", () => {
    expect(normalizeRecoveryCode(" ABCD-efgh 2345 ")).toBe("abcdefgh2345");
    expect(normalizeRecoveryCode("123456")).toBeNull();
    expect(normalizeRecoveryCode("abcd-efgh-234")).toBeNull();
  });

  it("hashes the normalized code with a key", () => {
    const h = hashRecoveryCode("abcd-efgh-2345", KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode("ABCDEFGH2345", KEY)).toBe(h);
    expect(hashRecoveryCode("abcd-efgh-2345", "other")).not.toBe(h);
    expect(hashRecoveryCode("not a code", KEY)).toBeNull();
  });
});
