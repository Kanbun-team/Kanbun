// Single sign-on (OpenID Connect) configuration and the pure decision logic
// for an SSO sign-in. Database access lives in src/server/sso.ts; this file
// only decides, so the rules are unit tested. See docs/SSO.md.

import { t, type DictKey, type Locale } from "@/lib/i18n";

export const SSO_PROVIDER_ID = "oidc";

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Button label, e.g. "Authentik". */
  name: string;
  scopes: string;
  allowSignup: boolean;
  /** Value of the `groups` claim that makes a user an admin. */
  adminGroup: string | null;
  /** Link an unlinked IdP account to the Kanbun user with the same username. */
  matchUsername: boolean;
  /** Hide the password form; admins keep a break-glass password login. */
  disablePassword: boolean;
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v?.trim() ?? "");

export function readSsoConfig(env: Record<string, string | undefined> = process.env): SsoConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return {
    // Kept exactly as given: it must equal the `issuer` in the discovery
    // document, and some IdPs (Authentik) use a trailing slash.
    issuer,
    clientId,
    clientSecret,
    name: env.OIDC_NAME?.trim() || "SSO",
    scopes: env.OIDC_SCOPES?.trim() || "openid profile email",
    allowSignup: truthy(env.OIDC_ALLOW_SIGNUP),
    adminGroup: env.OIDC_ADMIN_GROUP?.trim() || null,
    matchUsername: truthy(env.OIDC_MATCH_USERNAME),
    disablePassword: truthy(env.OIDC_DISABLE_PASSWORD),
  };
}

export function ssoConfig(): SsoConfig | null {
  return readSsoConfig();
}

/** Whether password sign-in is allowed for a role under the current config. */
export function passwordLoginAllowed(role: string, config: SsoConfig | null): boolean {
  return !config?.disablePassword || role === "admin";
}

export interface SsoClaims {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  name: string | null;
  groups: string[];
}

/** Normalizes an IdP profile (ID token or userinfo claims). */
export function claimsFromProfile(profile: Record<string, unknown> | null | undefined): SsoClaims | null {
  if (!profile) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const subject = str(profile.sub);
  if (!subject) return null;
  const verified = profile.email_verified;
  const rawGroups = profile.groups;
  return {
    subject,
    email: str(profile.email)?.toLowerCase() ?? null,
    // Some IdPs send "true" as a string.
    emailVerified: verified === true || verified === "true",
    username: str(profile.preferred_username),
    name: str(profile.name),
    groups: Array.isArray(rawGroups)
      ? rawGroups.filter((g): g is string => typeof g === "string")
      : typeof rawGroups === "string"
        ? [rawGroups]
        : [],
  };
}

export interface SsoCandidate {
  id: string;
  username: string;
  role: string;
  deactivated: boolean;
  /** Subject of this user's existing identity for the provider, if any. */
  linkedSubject: string | null;
}

export type SsoErrorCode =
  | "SsoNotLinked"
  | "SsoSignupDisabled"
  | "SsoDeactivated"
  | "SsoIdentityInUse"
  | "SsoAlreadyLinked"
  | "SsoInvalidProfile";

export type SsoDecision =
  | { kind: "login"; userId: string; role: string | null }
  | { kind: "link"; userId: string; role: string | null; auto: boolean }
  | { kind: "create"; role: string }
  | { kind: "deny"; error: SsoErrorCode };

export interface SsoDecisionInput {
  claims: SsoClaims | null;
  config: Pick<SsoConfig, "allowSignup" | "adminGroup" | "matchUsername">;
  /** The user already linked to this subject. */
  linked: SsoCandidate | null;
  /** The signed-in user who asked to link from Settings. */
  linkTo: SsoCandidate | null;
  /** Users whose email equals the claim (only looked up for a verified email). */
  emailMatches: SsoCandidate[];
  /** The user whose username equals preferred_username (only with matchUsername). */
  usernameMatch: SsoCandidate | null;
  /** Active admins, so group sync never removes the last one. */
  activeAdminCount: number;
}

/**
 * The role a sign-in should set, or null to keep the current one. With an
 * admin group configured the IdP decides: members of the group become admins,
 * others become members, except the last active admin is never demoted.
 */
export function syncedRole(
  current: string | null,
  claims: SsoClaims,
  adminGroup: string | null,
  activeAdminCount: number,
): string | null {
  if (!adminGroup) return null;
  const wantAdmin = claims.groups.includes(adminGroup);
  if (wantAdmin) return current === "admin" ? null : "admin";
  if (current === "admin" && activeAdminCount > 1) return "member";
  return null;
}

/**
 * Linking rules, in order:
 * 1. Linking from Settings: link the signed-in user, unless this IdP account
 *    belongs to someone else or the user already linked another one.
 * 2. An IdP account that is already linked signs in as its user.
 * 3. A verified email equal to exactly one user's email links that user.
 * 4. With OIDC_MATCH_USERNAME, preferred_username equal to a username links it.
 * 5. Otherwise a new member is created when sign-up is allowed.
 * Deactivated users are always refused, and a user who already has a
 * different IdP account linked is never auto-linked.
 */
export function decideSsoSignIn(input: SsoDecisionInput): SsoDecision {
  const { claims, config, linked, linkTo } = input;
  if (!claims) return { kind: "deny", error: "SsoInvalidProfile" };
  const role = (u: SsoCandidate) => syncedRole(u.role, claims, config.adminGroup, input.activeAdminCount);

  if (linkTo) {
    if (linkTo.deactivated) return { kind: "deny", error: "SsoDeactivated" };
    if (linked && linked.id !== linkTo.id) return { kind: "deny", error: "SsoIdentityInUse" };
    if (linkTo.linkedSubject && linkTo.linkedSubject !== claims.subject) {
      return { kind: "deny", error: "SsoAlreadyLinked" };
    }
    return { kind: "link", userId: linkTo.id, role: null, auto: false };
  }

  if (linked) {
    if (linked.deactivated) return { kind: "deny", error: "SsoDeactivated" };
    return { kind: "login", userId: linked.id, role: role(linked) };
  }

  const autoLink = (u: SsoCandidate): SsoDecision => {
    if (u.deactivated) return { kind: "deny", error: "SsoDeactivated" };
    if (u.linkedSubject) return { kind: "deny", error: "SsoNotLinked" };
    return { kind: "link", userId: u.id, role: role(u), auto: true };
  };

  if (claims.email && claims.emailVerified && input.emailMatches.length > 0) {
    if (input.emailMatches.length > 1) return { kind: "deny", error: "SsoNotLinked" };
    return autoLink(input.emailMatches[0]);
  }

  if (config.matchUsername && input.usernameMatch) return autoLink(input.usernameMatch);

  if (!config.allowSignup) return { kind: "deny", error: "SsoSignupDisabled" };
  const wantAdmin = !!config.adminGroup && claims.groups.includes(config.adminGroup);
  return { kind: "create", role: wantAdmin ? "admin" : "member" };
}

/** A valid Kanbun username (a-z, 0-9, _ . -, 2 to 32 characters) from IdP claims. */
export function baseUsername(claims: Pick<SsoClaims, "username" | "email">): string {
  const source = claims.username ?? claims.email?.split("@")[0] ?? "";
  let name = source
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 32);
  if (name.length < 2) name = "user";
  return name;
}

/** Candidates to try in order until one is free: name, name-2, name-3, ... */
export function usernameCandidates(base: string, count = 50): string[] {
  const out = [base];
  for (let i = 2; out.length < count; i++) {
    const suffix = `-${i}`;
    out.push(`${base.slice(0, 32 - suffix.length)}${suffix}`);
  }
  return out;
}

const SSO_ERROR_KEYS: Record<SsoErrorCode | "default", DictKey> = {
  SsoNotLinked: "authSsoNotLinked",
  SsoSignupDisabled: "authSsoSignupDisabled",
  SsoDeactivated: "authSsoDeactivated",
  SsoIdentityInUse: "authSsoIdentityInUse",
  SsoAlreadyLinked: "authSsoAlreadyLinked",
  SsoInvalidProfile: "authSsoInvalidProfile",
  default: "authSsoFailed",
};

/** Message for the `error` query parameter Auth.js puts on the login page. */
export function loginErrorMessage(code: string | undefined, locale: Locale = "en"): string | null {
  if (!code) return null;
  if (code in SSO_ERROR_KEYS) return t(SSO_ERROR_KEYS[code as SsoErrorCode], locale);
  if (code === "CredentialsSignin") return t("authInvalid", locale);
  return t(SSO_ERROR_KEYS.default, locale);
}

export function isSsoErrorCode(code: string): code is SsoErrorCode {
  return code in SSO_ERROR_KEYS && code !== "default";
}
