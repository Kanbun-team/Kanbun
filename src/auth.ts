import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db-local";
import { z } from "zod";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      role: string;
      accessTasks: boolean;
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
    accessTasks?: boolean;
    themePreference?: string;
    locale?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    role?: string;
    accessTasks?: boolean;
    themePreference?: string;
    locale?: string;
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
      const name = (error as { name?: string } | null)?.name;
      if (name === "CredentialsSignin" || name === "CallbackRouteError") return;
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
      async authorize(raw) {
        const parsed = credSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { username: username.toLowerCase() },
        });
        if (!user) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          accessTasks: user.accessTasks,
          themePreference: user.themePreference,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.displayName = user.displayName ?? null;
        token.avatarUrl = user.avatarUrl ?? null;
        token.role = user.role;
        token.accessTasks = user.accessTasks;
        token.themePreference = user.themePreference;
        token.locale = user.locale;
      }
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({ where: { id: token.id } });
        if (fresh) {
          token.username = fresh.username;
          token.displayName = fresh.displayName;
          token.avatarUrl = fresh.avatarUrl;
          token.role = fresh.role;
          token.accessTasks = fresh.accessTasks;
          token.themePreference = fresh.themePreference;
          token.locale = fresh.locale;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id;
        session.user.username = token.username ?? "";
        session.user.displayName = token.displayName ?? null;
        session.user.avatarUrl = token.avatarUrl ?? null;
        session.user.role = token.role ?? "support";
        session.user.accessTasks = token.accessTasks ?? false;
        session.user.themePreference = token.themePreference ?? "system";
        session.user.locale = token.locale ?? "en";
      }
      return session;
    },
  },
});

import type { Session } from "next-auth";

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
    throw new Error("Unauthorized");
  }
  return session.user;
}

export async function requireRole(role: "admin"): Promise<Session["user"]> {
  const user = await requireUser();
  if (user.role !== role) throw new Error("Forbidden");
  return user;
}

export async function requireAccessTasks(): Promise<Session["user"]> {
  const user = await requireUser();
  if (!user.accessTasks && user.role !== "admin") {
    throw new Error("Forbidden");
  }
  return user;
}
