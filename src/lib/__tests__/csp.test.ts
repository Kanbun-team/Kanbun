import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/csp";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    })
  );

describe("buildCsp", () => {
  it("only runs scripts carrying the request nonce", () => {
    const d = directives(buildCsp({ nonce: "abc123" }));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(d["script-src"]).not.toContain("'unsafe-inline'");
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
  });

  it("forbids framing and limits forms, connections and images", () => {
    const d = directives(buildCsp({ nonce: "n" }));
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    // https avatars, the data: QR code, blob: previews; never plain http.
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:", "https:"]);
  });

  it("lets the login form redirect to the single sign-on issuer", () => {
    const d = directives(buildCsp({ nonce: "n", ssoIssuer: "https://idp.example.com/application/o/kanbun/" }));
    expect(d["form-action"]).toEqual(["'self'", "https://idp.example.com"]);
    expect(directives(buildCsp({ nonce: "n", ssoIssuer: "not a url" }))["form-action"]).toEqual(["'self'"]);
  });

  it("relaxes only what development needs", () => {
    const d = directives(buildCsp({ nonce: "n", dev: true }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["connect-src"]).toEqual(["'self'", "ws:", "wss:"]);
  });

  it("creates unpredictable nonces", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
