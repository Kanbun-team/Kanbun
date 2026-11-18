import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// /setup is the first-run wizard; it checks for itself whether it may run.
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
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
  return NextResponse.next();
}

// api/attachments and api/import are left out so uploads are not buffered
// (and capped at 10 MB) by the proxy; those routes check the session themselves.
// api/v1 (the REST API) is left out because it never uses the session: every
// route authenticates its bearer token (src/server/api/http.ts) and answers
// 401 in JSON instead of redirecting to the login page.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|api/auth|api/attachments|api/import|api/v1/).*)",
  ],
};
