import { describe, expect, it } from "vitest";
import {
  baseUsername,
  claimsFromProfile,
  decideSsoSignIn,
  loginErrorMessage,
  passwordLoginAllowed,
  readSsoConfig,
  syncedRole,
  usernameCandidates,
  type SsoCandidate,
  type SsoClaims,
  type SsoDecisionInput,
} from "@/lib/sso";
import { hasUsablePassword, NO_PASSWORD_HASH } from "@/lib/password";

const claims = (over: Partial<SsoClaims> = {}): SsoClaims => ({
  subject: "sub-1",
  email: "marta@example.com",
  emailVerified: true,
  username: "marta",
  name: "Marta",
  groups: [],
  ...over,
});

const user = (over: Partial<SsoCandidate> = {}): SsoCandidate => ({
  id: "u1",
  username: "marta",
  role: "member",
  deactivated: false,
  linkedSubject: null,
  ...over,
});

const input = (over: Partial<SsoDecisionInput> = {}): SsoDecisionInput => ({
  claims: claims(),
  config: { allowSignup: false, adminGroup: null, matchUsername: false },
  linked: null,
  linkTo: null,
  emailMatches: [],
  usernameMatch: null,
  activeAdminCount: 2,
  ...over,
});

describe("readSsoConfig", () => {
  it("is off without issuer, client id and secret", () => {
    expect(readSsoConfig({})).toBeNull();
    expect(readSsoConfig({ OIDC_ISSUER: "https://idp", OIDC_CLIENT_ID: "id" })).toBeNull();
  });

  it("reads defaults and flags", () => {
    const c = readSsoConfig({
      OIDC_ISSUER: "https://idp.example.com/application/o/kanbun/",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
    })!;
    expect(c.issuer).toBe("https://idp.example.com/application/o/kanbun/");
    expect(c.name).toBe("SSO");
    expect(c.scopes).toBe("openid profile email");
    expect(c.allowSignup).toBe(false);
    expect(c.disablePassword).toBe(false);
    expect(c.adminGroup).toBeNull();

    const d = readSsoConfig({
      OIDC_ISSUER: "https://idp",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_NAME: "Authentik",
      OIDC_ALLOW_SIGNUP: "true",
      OIDC_DISABLE_PASSWORD: "1",
      OIDC_ADMIN_GROUP: "kanbun-admins",
      OIDC_MATCH_USERNAME: "yes",
    })!;
    expect(d).toMatchObject({ name: "Authentik", allowSignup: true, disablePassword: true, adminGroup: "kanbun-admins", matchUsername: true });
  });

  it("keeps password login for admins only when disabled", () => {
    const off = readSsoConfig({ OIDC_ISSUER: "i", OIDC_CLIENT_ID: "c", OIDC_CLIENT_SECRET: "s", OIDC_DISABLE_PASSWORD: "true" });
    expect(passwordLoginAllowed("member", off)).toBe(false);
    expect(passwordLoginAllowed("admin", off)).toBe(true);
    expect(passwordLoginAllowed("member", null)).toBe(true);
  });
});

describe("claimsFromProfile", () => {
  it("normalizes email, verification and groups", () => {
    expect(
      claimsFromProfile({ sub: "abc", email: "Marta@Example.com", email_verified: "true", preferred_username: "marta", groups: ["a", 1, "b"] }),
    ).toEqual({ subject: "abc", email: "marta@example.com", emailVerified: true, username: "marta", name: null, groups: ["a", "b"] });
    expect(claimsFromProfile({ sub: "abc", groups: "admins" })?.groups).toEqual(["admins"]);
    expect(claimsFromProfile({ sub: "abc" })?.emailVerified).toBe(false);
  });

  it("requires a subject", () => {
    expect(claimsFromProfile({ email: "a@b.c" })).toBeNull();
    expect(claimsFromProfile(undefined)).toBeNull();
  });
});

describe("decideSsoSignIn", () => {
  it("signs in a linked user", () => {
    expect(decideSsoSignIn(input({ linked: user({ linkedSubject: "sub-1" }) }))).toEqual({ kind: "login", userId: "u1", role: null });
  });

  it("refuses deactivated users, linked or matched", () => {
    expect(decideSsoSignIn(input({ linked: user({ deactivated: true }) }))).toEqual({ kind: "deny", error: "SsoDeactivated" });
    expect(decideSsoSignIn(input({ emailMatches: [user({ deactivated: true })] }))).toEqual({ kind: "deny", error: "SsoDeactivated" });
    expect(decideSsoSignIn(input({ linkTo: user({ deactivated: true }) }))).toEqual({ kind: "deny", error: "SsoDeactivated" });
  });

  it("auto-links one user with the same verified email", () => {
    expect(decideSsoSignIn(input({ emailMatches: [user()] }))).toEqual({ kind: "link", userId: "u1", role: null, auto: true });
  });

  it("does not trust an unverified email", () => {
    const d = decideSsoSignIn(input({ claims: claims({ emailVerified: false }), emailMatches: [user()] }));
    expect(d).toEqual({ kind: "deny", error: "SsoSignupDisabled" });
  });

  it("does not auto-link when the email is ambiguous or the user has another identity", () => {
    expect(decideSsoSignIn(input({ emailMatches: [user(), user({ id: "u2" })] }))).toEqual({ kind: "deny", error: "SsoNotLinked" });
    expect(decideSsoSignIn(input({ emailMatches: [user({ linkedSubject: "other" })] }))).toEqual({ kind: "deny", error: "SsoNotLinked" });
  });

  it("matches usernames only when enabled", () => {
    expect(decideSsoSignIn(input({ usernameMatch: user() }))).toEqual({ kind: "deny", error: "SsoSignupDisabled" });
    const on = input({ usernameMatch: user(), config: { allowSignup: false, adminGroup: null, matchUsername: true } });
    expect(decideSsoSignIn(on)).toEqual({ kind: "link", userId: "u1", role: null, auto: true });
  });

  it("creates a member only when sign-up is allowed", () => {
    expect(decideSsoSignIn(input())).toEqual({ kind: "deny", error: "SsoSignupDisabled" });
    const signup = input({ config: { allowSignup: true, adminGroup: null, matchUsername: false } });
    expect(decideSsoSignIn(signup)).toEqual({ kind: "create", role: "member" });
  });

  it("creates admins from the admin group", () => {
    const d = decideSsoSignIn(
      input({ claims: claims({ groups: ["kanbun-admins"] }), config: { allowSignup: true, adminGroup: "kanbun-admins", matchUsername: false } }),
    );
    expect(d).toEqual({ kind: "create", role: "admin" });
  });

  it("links the signed-in user from Settings", () => {
    expect(decideSsoSignIn(input({ linkTo: user() }))).toEqual({ kind: "link", userId: "u1", role: null, auto: false });
    // Relinking the same identity is harmless.
    expect(decideSsoSignIn(input({ linkTo: user({ linkedSubject: "sub-1" }), linked: user({ linkedSubject: "sub-1" }) }))).toMatchObject({ kind: "link" });
  });

  it("refuses to link an identity owned by someone else, or a second identity", () => {
    expect(decideSsoSignIn(input({ linkTo: user(), linked: user({ id: "u2" }) }))).toEqual({ kind: "deny", error: "SsoIdentityInUse" });
    expect(decideSsoSignIn(input({ linkTo: user({ linkedSubject: "other" }) }))).toEqual({ kind: "deny", error: "SsoAlreadyLinked" });
  });

  it("refuses an unusable profile", () => {
    expect(decideSsoSignIn(input({ claims: null }))).toEqual({ kind: "deny", error: "SsoInvalidProfile" });
  });
});

describe("syncedRole", () => {
  it("keeps roles without an admin group", () => {
    expect(syncedRole("admin", claims(), null, 1)).toBeNull();
  });
  it("promotes group members and demotes others, never the last admin", () => {
    expect(syncedRole("member", claims({ groups: ["g"] }), "g", 1)).toBe("admin");
    expect(syncedRole("admin", claims({ groups: ["g"] }), "g", 1)).toBeNull();
    expect(syncedRole("admin", claims(), "g", 2)).toBe("member");
    expect(syncedRole("admin", claims(), "g", 1)).toBeNull();
    expect(syncedRole("member", claims(), "g", 1)).toBeNull();
  });
});

describe("usernames for new SSO users", () => {
  it("derives a valid username", () => {
    expect(baseUsername({ username: "Marta Rossi", email: null })).toBe("marta-rossi");
    expect(baseUsername({ username: null, email: "j.doe+x@example.com" })).toBe("j.doe-x");
    expect(baseUsername({ username: "ü", email: null })).toBe("user");
    expect(baseUsername({ username: "a".repeat(40), email: null })).toHaveLength(32);
  });
  it("suffixes candidates within 32 characters", () => {
    const c = usernameCandidates("a".repeat(32), 3);
    expect(c[0]).toHaveLength(32);
    expect(c[1]).toBe(`${"a".repeat(30)}-2`);
    expect(c[2]).toBe(`${"a".repeat(30)}-3`);
  });
});

describe("login error messages", () => {
  it("explains the SSO error codes", () => {
    expect(loginErrorMessage("SsoNotLinked")).toMatch(/not linked/);
    expect(loginErrorMessage("SsoSignupDisabled")).toMatch(/administrator/);
    expect(loginErrorMessage("SsoDeactivated")).toMatch(/deactivated/);
    expect(loginErrorMessage("OAuthCallbackError")).toMatch(/failed/);
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});

describe("passwordless accounts", () => {
  it("never treat the SSO marker as a password", () => {
    expect(hasUsablePassword(NO_PASSWORD_HASH)).toBe(false);
    expect(hasUsablePassword("$2a$12$abcdefghijklmnopqrstuv")).toBe(true);
    expect(hasUsablePassword(null)).toBe(false);
  });
});
