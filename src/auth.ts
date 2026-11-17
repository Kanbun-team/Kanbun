import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type {} from "next-auth/jwt";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db-local";
import { z } from "zod";
import { ActionError } from "@/lib/action-result";
import { clientIp, isLoginBlocked, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      role: string;
      themePreference: string;
      locale: string;
    };
  }
  interface User {
    id?: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    role?: string;
    themePreference?: string;
    locale?: string;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    role?: string;
    themePreference?: string;
    locale?: string;
    sessionVersion?: number;
  }
}

const credSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const { handlers, auth, signIn, signOut, unstable_update: refreshSession } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  logger: {
    error(error) {
      // `type` survives minification in production builds; `name` does not.
      const { type, name } = (error ?? {}) as { type?: string; name?: string };
      const kind = type ?? name;
      if (kind === "CredentialsSignin" || kind === "CallbackRouteError") return;
      console.error(error);
    },
    warn() {},
    debug() {},
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credSchema.safeParse(raw);
        if (!parsed.success) return null;
        const username = parsed.data.username.toLowerCase();
        const { password } = parsed.data;
        const ip = clientIp(request?.headers);
        if (isLoginBlocked(ip, username)) return null;
        const user = await prisma.user.findUnique({ where: { username } });
        const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
        if (!user || !ok || user.deactivatedAt) {
          recordLoginFailure(ip, username);
          return null;
        }
        recordLoginSuccess(ip, username);
        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          themePreference: user.themePreference,
          locale: user.locale,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
      }
      if (!token.id) return null;

      // Re-read the user on every request instead of trusting claims baked
      // into a 30-day token: a deleted or deactivated user, a demoted admin, or a password
      // reset (which bumps sessionVersion) takes effect immediately.
      const fresh = await prisma.user.findUnique({
        where: { id: token.id },
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          themePreference: true,
          locale: true,
          sessionVersion: true,
          deactivatedAt: true,
        },
      });
      if (!fresh || fresh.deactivatedAt || fresh.sessionVersion !== (token.sessionVersion ?? 0)) return null;

      token.username = fresh.username;
      token.displayName = fresh.displayName;
      token.avatarUrl = fresh.avatarUrl;
      token.role = fresh.role;
      token.themePreference = fresh.themePreference;
      token.locale = fresh.locale;
      return token;
    },
    async session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id;
        session.user.username = token.username ?? "";
        session.user.displayName = token.displayName ?? null;
        session.user.avatarUrl = token.avatarUrl ?? null;
        session.user.role = token.role ?? "member";
        session.user.themePreference = token.themePreference ?? "system";
        session.user.locale = token.locale ?? "en";
      }
      return session;
    },
  },
});

export type SafeAuthResult =
  | { status: "ok"; session: Session }
  | { status: "anonymous" }
  | { status: "bad-cookie"; error: unknown };

export async function safeAuth(): Promise<SafeAuthResult> {
  try {
    const session = (await auth()) as Session | null;
    if (!session?.user?.id) return { status: "anonymous" };
    return { status: "ok", session };
  } catch (error) {
    return { status: "bad-cookie", error };
  }
}

export async function requireUser(): Promise<Session["user"]> {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    throw new ActionError("unauthorized");
  }
  return session.user;
}

// For server components under (app)/. The layout already guards these routes,
// but pages render in parallel with it, so a session invalidated mid-flight
// (deleted user, password reset) must redirect here too instead of crashing.
export async function requirePageUser(): Promise<Session["user"]> {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireRole(role: "admin"): Promise<Session["user"]> {
  const user = await requireUser();
  if (user.role !== role) throw new ActionError("forbidden");
  return user;
}
