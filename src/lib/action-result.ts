// Typed results for server actions. Actions never throw to the client: they
// return { ok: false, error } with a code the UI translates into a toast.
// (Next.js hides thrown error messages in production builds, so a thrown
// error could only ever produce a generic error page.)

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "notFound",
  "invalid",
  "selfAction",
  "userNotFound",
  "usernameTaken",
  "crossBoard",
  "noColumns",
  "restoreBoardFirst",
  "limitReached",
  "webhookUrl",
  "invalidCode",
  "tooManyAttempts",
  "lastSignInMethod",
  "unknown",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ErrorCode };

export class ActionError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = "ActionError";
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
