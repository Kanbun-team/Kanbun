import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import type {} from "next-auth/jwt";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db-local";
import { z } from "zod";
import { ActionError } from "@/lib/action-result";
import { clientIp, isLoginBlocked, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { audit } from "@/server/audit";
import { hasUsablePassword } from "@/lib/password";
import { SSO_PROVIDER_ID, passwordLoginAllowed, ssoConfig } from "@/lib/sso";
import { verifySecondFactor } from "@/server/two-factor";
import { handleSsoSignIn, resolveSsoUser } from "@/server/sso";

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
  // Two-factor code or recovery code, sent on the second login step.
  code: z.string().max(64).optional(),
});

/**
 * Thrown by authorize when the password was right but a second factor is
 * needed ("totp_required") or the code was wrong ("totp_invalid"). The login
 * action reads `code` to show the code step.
 */
export class SecondFactorError extends CredentialsSignin {
  constructor(code: "totp_required" | "totp_invalid") {
    super();
    this.code = code;
  }
}

const sso = ssoConfig();

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
        code: { label: "Code", type: "text" },
      },
      async authorize(raw, request) {
        const parsed = credSchema.safeParse(raw);
        if (!parsed.success) return null;
        const username = parsed.data.username.toLowerCase();
        const { password } = parsed.data;
        const ip = clientIp(request?.headers);
        const auditIp = ip === "unknown" ? null : ip;
        // Failed attempts record the username that was tried, never the password.
        const failed = (reason: string, actor?: { id: string; name: string } | null) =>
          audit({
            action: "login.failure",
            actor: actor ?? null,
            target: { type: "user", id: actor?.id ?? null, name: username },
            details: { username, reason },
            ip: auditIp,
          });
        // Blocked attempts are not recorded one by one: the failures that led
        // to the block are, and a flood must not be able to fill the log.
        if (await isLoginBlocked(ip, username)) return null;
        const user = await prisma.user.findUnique({ where: { username } });
        const ok = user && hasUsablePassword(user.passwordHash) ? await bcrypt.compare(password, user.passwordHash) : false;
        if (!user || !ok || user.deactivatedAt) {
          await recordLoginFailure(ip, username);
          const reason = !user ? "unknownUser" : !ok ? "badPassword" : "deactivated";
          await failed(reason, user ? { id: user.id, name: user.username } : null);
          return null;
        }
        // Single sign-on and two-factor checks (src/lib/sso.ts, src/server/two-factor.ts).
        if (!passwordLoginAllowed(user.role, sso)) return null;
        const second = await verifySecondFactor(user, parsed.data.code);
        if (second === "invalid") await recordLoginFailure(ip, username);
        if (second !== "ok") throw new SecondFactorError(second === "required" ? "totp_required" : "totp_invalid");
        await recordLoginSuccess(ip, username);
        await audit({
          action: "login.success",
          actor: { id: user.id, name: user.username },
          target: { type: "user", id: user.id, name: user.username },
          ip: auditIp,
        });
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
    ...(sso
      ? [
          {
            id: SSO_PROVIDER_ID,
            name: sso.name,
            type: "oidc" as const,
            issuer: sso.issuer,
            clientId: sso.clientId,
            clientSecret: sso.clientSecret,
            authorization: { params: { scope: sso.scopes } },
            checks: ["pkce", "state"] as ("pkce" | "state")[],
            // Read claims from the userinfo endpoint (after validating the ID
            // token): IdPs put groups and email_verified there more reliably.
            idToken: false,
          },
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== SSO_PROVIDER_ID) return true;
      return handleSsoSignIn(profile as Record<string, unknown> | undefined, async () => {
        const current = (await auth()) as Session | null;
        return current?.user?.id ?? null;
      });
    },
    async jwt({ token, user, account, profile }) {
      if (user && account?.provider === SSO_PROVIDER_ID) {
        // `user` is the IdP profile here; map its subject to the linked Kanbun user.
        const subject = (typeof profile?.sub === "string" && profile.sub) || account.providerAccountId;
        const linked = await resolveSsoUser(subject);
        if (!linked) return null;
        token.id = linked.id;
        token.sessionVersion = linked.sessionVersion;
      } else if (user) {
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
