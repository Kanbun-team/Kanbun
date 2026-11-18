// Accounts created through single sign-on have no password. Their
// passwordHash holds this marker, which no bcrypt comparison can match.
export const NO_PASSWORD_HASH = "!sso-only";

export function hasUsablePassword(hash: string | null | undefined): boolean {
  return !!hash && hash.startsWith("$2");
}

/**
 * A bcrypt hash (cost 12, like real ones) of a throwaway value. Logins for
 * unknown users and SSO-only accounts compare against it, so the response
 * time does not tell which usernames exist.
 */
export const TIMING_HASH = "$2a$12$icKFfcIwv9q8tuj2sqmjyeFP/JBwr7YzePhJ/gGDeu0Bbw6KYFwku";
