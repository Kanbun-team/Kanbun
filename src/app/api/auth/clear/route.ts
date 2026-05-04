import { NextResponse, type NextRequest } from "next/server";

const COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "panelSessionId",
];

function isSafePath(value: string | null): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}

function buildResponse(req: NextRequest, to: string) {
  const url = req.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  const res = NextResponse.redirect(url);
  for (const name of COOKIES) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to");
  return buildResponse(req, isSafePath(to) ? to : "/login");
}

export async function POST(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to");
  return buildResponse(req, isSafePath(to) ? to : "/login");
}
