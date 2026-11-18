import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/csp";

// /setup is the first-run wizard; it checks for itself whether it may run.
// /offline is the service worker's fallback page (no user data).
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth", "/offline"];

/**
 * Passes the request on with a Content-Security-Policy carrying a fresh
 * nonce (src/lib/csp.ts). Next.js reads the nonce from the request header and
 * adds it to its scripts; the root layout reads `x-nonce` for its own one.
 */
function withCsp(req: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    ssoIssuer: process.env.OIDC_ISSUER,
  });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return withCsp(req);
  }
  const sessionCookie =
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value;
  if (!sessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return withCsp(req);
}

// api/attachments and api/import are left out so uploads are not buffered
// (and capped at 10 MB) by the proxy; those routes check the session themselves.
// api/v1 (the REST API) is left out because it never uses the session: every
// route authenticates its bearer token (src/server/api/http.ts) and answers
// 401 in JSON instead of redirecting to the login page. sw.js is the service
// worker script, which the browser re-checks even when signed out.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|api/auth|api/attachments|api/import|api/v1/).*)",
  ],
};
