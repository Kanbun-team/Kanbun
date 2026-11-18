// Accounts created through single sign-on have no password. Their
// passwordHash holds this marker, which no bcrypt comparison can match.
export const NO_PASSWORD_HASH = "!sso-only";

export function hasUsablePassword(hash: string | null | undefined): boolean {
  return !!hash && hash.startsWith("$2");
}
