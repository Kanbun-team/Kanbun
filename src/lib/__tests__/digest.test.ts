import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDigestEmail } from "@/server/jobs/digest";

describe("buildDigestEmail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists each notification with a link to its card and escapes HTML", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://kanbun.example/");
    const mail = buildDigestEmail(
      "ada@example.com",
      [
        { type: "comment", cardTitle: "<b>Fix</b>", actorName: "Bob", cardId: "c1", boardId: "b1" },
        { type: "dueSoon", cardTitle: "Ship", actorName: null, cardId: "c2", boardId: "b1" },
      ],
      "en"
    );
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toBe("Kanbun: 2 unread notifications");
    expect(mail.text).toContain('Bob commented on "<b>Fix</b>"');
    expect(mail.text).toContain("https://kanbun.example/tasks/b1/cards/c1");
    expect(mail.html).toContain("&lt;b&gt;Fix&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Fix</b>");
    expect(mail.html).toContain('href="https://kanbun.example/tasks/b1/cards/c2"');
  });

  it("caps the list and says how many more there are", () => {
    const items = Array.from({ length: 55 }, (_, i) => ({
      type: "newCard",
      cardTitle: `Card ${i}`,
      actorName: "Bob",
      cardId: `c${i}`,
      boardId: "b",
    }));
    const mail = buildDigestEmail("a@b.c", items, "en");
    expect(mail.text).toContain("And 5 more in Kanbun.");
    expect(mail.text).not.toContain("Card 54");
  });
});
