import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage } from "@/lib/accept-language";
import { loginErrorMessage } from "@/lib/sso";

describe("Accept-Language", () => {
  it("picks the best supported language by quality, then order", () => {
    expect(localeFromAcceptLanguage("pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pl");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,de;q=0.8,it;q=0.7")).toBe("de");
    expect(localeFromAcceptLanguage("en;q=0.5, it")).toBe("it");
    expect(localeFromAcceptLanguage("de-AT")).toBe("de");
    expect(localeFromAcceptLanguage("IT-it")).toBe("it");
  });

  it("returns null when nothing is supported", () => {
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage("fr,es;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("pl;q=0")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
  });

  it("translates login errors", () => {
    expect(loginErrorMessage("CredentialsSignin", "pl")).toBe("Nieprawidłowa nazwa użytkownika lub hasło.");
    expect(loginErrorMessage("SsoDeactivated", "de")).toMatch(/deaktiviert/);
    expect(loginErrorMessage("Weird", "it")).toMatch(/Single sign-on non riuscito/);
  });
});
