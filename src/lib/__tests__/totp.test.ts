import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  formatSecret,
  generateTotpSecret,
  hotp,
  normalizeTotpCode,
  otpauthUri,
  timeStep,
  totp,
  verifyTotp,
} from "@/lib/totp";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("base32 (RFC 4648)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [plain, encoded] of vectors) {
    it(`encodes "${plain}"`, () => {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    });
    it(`decodes "${encoded}"`, () => {
      expect(base32Decode(encoded).toString()).toBe(plain);
    });
  }

  it("decodes padding, spaces, dashes and lowercase", () => {
    expect(base32Decode("mzxw 6ytb-oi======").toString()).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });

  it("round-trips random secrets", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe("HOTP (RFC 4226 appendix D)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => {
    it(`counter ${counter}`, () => {
      expect(hotp(RFC_SECRET, counter)).toBe(code);
    });
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    it(`T=${seconds}`, () => {
      expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code);
    });
  }

  it("uses 6 digits by default (last six of the 8 digit value)", () => {
    expect(totp(RFC_SECRET, 59_000)).toBe("287082");
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;
  const step = timeStep(now);

  it("accepts the current code and returns its step", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(step);
  });

  it("accepts one step of drift either way, not two", () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 60_000), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 60_000), now)).toBeNull();
  });

  it("rejects a code whose step was already used (replay)", () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
    // An older code is refused once a newer one was used.
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now, step)).toBeNull();
  });

  it("rejects wrong and malformed codes", () => {
    const right = totp(RFC_SECRET, now);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, "0");
    expect(verifyTotp(RFC_SECRET, wrong, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now)).toBeNull();
  });

  it("allows spaces in the code", () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
  });
});

describe("otpauth URI", () => {
  it("has the label, secret and parameters apps expect", () => {
    const uri = otpauthUri({ issuer: "Kanbun", account: "marta", secret: "JBSWY3DPEHPK3PXP" });
    expect(uri.startsWith("otpauth://totp/Kanbun%3Amarta?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(params.get("issuer")).toBe("Kanbun");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });

  it("groups the secret for manual entry", () => {
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
