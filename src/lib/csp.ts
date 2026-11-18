// Content-Security-Policy for HTML pages, sent by src/proxy.ts with a fresh
// nonce per request. Next.js reads the nonce from the request's CSP header
// and puts it on its own scripts; 'strict-dynamic' lets those load the page
// chunks, so no other script (injected markup, a third-party host) can run.
//
// - style-src keeps 'unsafe-inline': React renders style attributes, which a
//   nonce can not cover. Styles can not run code.
// - img-src allows https: for user avatars (src/lib/avatar.ts accepts https
//   URLs only), data: for the two-factor QR code and blob: for previews.
// - form-action adds the single sign-on issuer, because the login form's
//   redirect to the identity provider counts as part of the form submission.
// Other security headers that do not change per request are set in
// next.config.mjs.

export interface CspOptions {
  nonce: string;
  /** Development: React needs eval for its debugging features, and HMR uses a websocket. */
  dev?: boolean;
  /** OIDC_ISSUER, when single sign-on is configured. */
  ssoIssuer?: string | null;
}

/** The origin of a URL, or null when it is not an http(s) URL. */
function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, dev = false, ssoIssuer = null }: CspOptions): string {
  const issuer = originOf(ssoIssuer);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(dev ? ["ws:", "wss:"] : [])]],
    ["media-src", ["'self'"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", ...(issuer ? [issuer] : [])]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** A random nonce: 128 bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
