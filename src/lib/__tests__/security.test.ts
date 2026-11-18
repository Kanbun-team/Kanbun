import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/utils";
import { safeAvatarUrl } from "@/lib/avatar";

describe("safeRedirect", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirect("/tasks/abc?x=1#y", "/tasks")).toBe("/tasks/abc?x=1#y");
  });

  it("refuses anything that can leave the site", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(safeRedirect(bad, "/tasks")).toBe("/tasks");
    }
  });
});

describe("safeAvatarUrl", () => {
  it("allows https image URLs", () => {
    expect(safeAvatarUrl("https://example.com/me.png")).toBe("https://example.com/me.png");
    expect(safeAvatarUrl("  https://example.com/me.png ")).toBe("https://example.com/me.png");
  });

  it("drops other schemes and malformed values", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "http://example.com/me.png",
      "//example.com/me.png",
      "/api/attachments/x",
      "https://user:pass@example.com/me.png",
      "https://example.com/" + "a".repeat(600),
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(safeAvatarUrl(bad)).toBeNull();
    }
  });
});
