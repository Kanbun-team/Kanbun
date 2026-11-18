import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowPrivateTargets,
  checkWebhookUrl,
  isBlockedAddress,
  parseEvents,
  signPayload,
  verifySignature,
} from "@/lib/webhooks";

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "card.created", card: { id: "c1" } });

  it("signs the raw body with HMAC-SHA256", () => {
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    expect(signPayload(secret, body)).toBe(`sha256=${hex}`);
  });

  it("verifies matching signatures only", () => {
    const sig = signPayload(secret, body);
    expect(verifySignature(secret, body, sig)).toBe(true);
    expect(verifySignature("other", body, sig)).toBe(false);
    expect(verifySignature(secret, body + " ", sig)).toBe(false);
    expect(verifySignature(secret, body, null)).toBe(false);
    expect(verifySignature(secret, body, "sha256=00")).toBe(false);
  });
});

describe("webhook events", () => {
  it("keeps known events only", () => {
    expect(parseEvents('["card.created","nope","comment.created"]')).toEqual(["card.created", "comment.created"]);
    expect(parseEvents("not json")).toEqual([]);
    expect(parseEvents('{"a":1}')).toEqual([]);
    expect(parseEvents(null)).toEqual([]);
  });
});

describe("SSRF address check", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:0808:0808::"])(
    "allows %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );
});

describe("webhook URL check", () => {
  it("accepts public http(s) URLs", () => {
    expect(checkWebhookUrl("https://example.com/hook").ok).toBe(true);
    expect(checkWebhookUrl("http://93.184.216.34:8080/x").ok).toBe(true);
  });

  it("rejects other schemes, credentials and garbage", () => {
    expect(checkWebhookUrl("ftp://example.com")).toEqual({ ok: false, reason: "protocol" });
    expect(checkWebhookUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "protocol" });
    expect(checkWebhookUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "protocol" });
    expect(checkWebhookUrl("https://user:pw@example.com")).toEqual({ ok: false, reason: "credentials" });
    expect(checkWebhookUrl("not a url")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects private literals and localhost unless allowed", () => {
    for (const url of ["http://127.0.0.1/", "http://[::1]:3000/", "http://localhost/", "http://api.localhost/", "http://169.254.169.254/latest", "http://0x7f000001/", "http://2130706433/"]) {
      expect(checkWebhookUrl(url).ok, url).toBe(false);
      expect(checkWebhookUrl(url, true).ok, url).toBe(true);
    }
  });

  it("reads WEBHOOK_ALLOW_PRIVATE", () => {
    expect(allowPrivateTargets({ WEBHOOK_ALLOW_PRIVATE: "1" })).toBe(true);
    expect(allowPrivateTargets({ WEBHOOK_ALLOW_PRIVATE: "true" })).toBe(false);
    expect(allowPrivateTargets({})).toBe(false);
  });
});
