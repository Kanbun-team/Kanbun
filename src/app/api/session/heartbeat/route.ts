import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { detectDeviceType } from "@/lib/sessions";

const COOKIE = "panelSessionId";
const MAX_AGE = 60 * 60 * 24 * 30;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const userId = session.user.id;
  const hdrs = await headers();
  const ua = hdrs.get("user-agent");
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    null;
  const deviceType = detectDeviceType(ua);

  const cookieStore = await cookies();
  const existingId = cookieStore.get(COOKIE)?.value;

  let row = existingId
    ? await prisma.userSession.findUnique({ where: { id: existingId } })
    : null;

  if (!row || row.userId !== userId) {
    row = await prisma.userSession.create({
      data: {
        userId,
        deviceType,
        userAgent: ua ?? null,
        ipAddress: ip,
      },
    });
  } else {
    row = await prisma.userSession.update({
      where: { id: row.id },
      data: {
        deviceType,
        userAgent: ua ?? null,
        ipAddress: ip,
        lastSeenAt: new Date(),
      },
    });
  }

  cookieStore.set(COOKIE, row.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
