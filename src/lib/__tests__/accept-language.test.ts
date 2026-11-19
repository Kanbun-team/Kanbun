import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage } from "@/lib/accept-language";
import { loginErrorMessage } from "@/lib/sso";

describe("Accept-Language", () => {
  it("picks the best supported language by quality, then order", () => {
    expect(localeFromAcceptLanguage("pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pl");
    expect(localeFromAcceptLanguage("ja-JP,ja;q=0.9,de;q=0.8,it;q=0.7")).toBe("de");
    expect(localeFromAcceptLanguage("en;q=0.5, it")).toBe("it");
    expect(localeFromAcceptLanguage("de-AT")).toBe("de");
    expect(localeFromAcceptLanguage("IT-it")).toBe("it");
  });

  it("matches French, Spanish and Portuguese in any regional variant", () => {
    expect(localeFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeFromAcceptLanguage("es-MX,es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.5")).toBe("pt");
    expect(localeFromAcceptLanguage("pt-PT")).toBe("pt");
  });

  it("returns null when nothing is supported", () => {
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage("ja,ko;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("pl;q=0")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
  });

  it("translates login errors", () => {
    expect(loginErrorMessage("CredentialsSignin", "pl")).toBe("Nieprawidłowa nazwa użytkownika lub hasło.");
    expect(loginErrorMessage("SsoDeactivated", "de")).toMatch(/deaktiviert/);
    expect(loginErrorMessage("Weird", "it")).toMatch(/Single sign-on non riuscito/);
    for (const locale of ["fr", "es", "pt"] as const) {
      expect(loginErrorMessage("CredentialsSignin", locale)).not.toBe(loginErrorMessage("CredentialsSignin", "en"));
    }
  });
});
