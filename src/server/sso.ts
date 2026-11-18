// Single sign-on account handling for the Auth.js callbacks. Sessions are
// JWTs without a database adapter, so linking IdP accounts to users
// (UserIdentity) happens here. The rules are in decideSsoSignIn
// (src/lib/sso.ts). Server-only.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db-local";
import { deriveKey } from "@/lib/secret-box";
import { NO_PASSWORD_HASH } from "@/lib/password";
import {
  SSO_PROVIDER_ID,
  baseUsername,
  claimsFromProfile,
  decideSsoSignIn,
  ssoConfig,
  usernameCandidates,
  type SsoCandidate,
} from "@/lib/sso";
import { audit } from "@/server/audit";

export const LINK_COOKIE = "kanbun_sso_link";
const LINK_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", deriveKey("sso-link-v1")).update(payload).digest("base64url");
}

/** Remembers, for ten minutes, that the signed-in user asked to link an SSO account. */
export async function setLinkIntent(userId: string): Promise<void> {
  const payload = `${userId}.${Date.now() + LINK_TTL_MS}`;
  const jar = await cookies();
  jar.set(LINK_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").startsWith("https:"),
    path: "/",
    maxAge: LINK_TTL_MS / 1000,
  });
}

export async function clearLinkIntent(): Promise<void> {
  try {
    (await cookies()).delete(LINK_COOKIE);
  } catch {
    // outside a request
  }
}

/** The user id from a valid, unexpired link cookie (consumed on read). */
async function takeLinkIntent(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(LINK_COOKIE)?.value;
  if (!raw) return null;
  jar.delete(LINK_COOKIE);
  const [userId, expires, mac] = raw.split(".");
  if (!userId || !expires || !mac) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now()) return null;
  return userId;
}

async function candidate(where: { id: string } | { username: string }): Promise<SsoCandidate | null> {
  const u = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      username: true,
      role: true,
      deactivatedAt: true,
      identities: { where: { provider: SSO_PROVIDER_ID }, select: { subject: true }, take: 1 },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    deactivated: !!u.deactivatedAt,
    linkedSubject: u.identities[0]?.subject ?? null,
  };
}

async function emailCandidates(email: string): Promise<SsoCandidate[]> {
  // Emails are stored as typed; SQLite compares case-sensitively, so filter here.
  const users = await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true },
  });
  const ids = users.filter((u) => u.email!.trim().toLowerCase() === email).map((u) => u.id);
  const out = await Promise.all(ids.map((id) => candidate({ id })));
  return out.filter((c): c is SsoCandidate => !!c);
}

async function createSsoUser(
  claims: NonNullable<ReturnType<typeof claimsFromProfile>>,
  role: string,
): Promise<{ id: string; username: string }> {
  const base = baseUsername(claims);
  for (const username of usernameCandidates(base)) {
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (taken) continue;
    return prisma.user.create({
      data: {
        username,
        passwordHash: NO_PASSWORD_HASH,
        displayName: claims.name ?? claims.username ?? username,
        email: claims.emailVerified ? claims.email : null,
        role,
        identities: {
          create: { provider: SSO_PROVIDER_ID, subject: claims.subject, email: claims.email },
        },
      },
      select: { id: true, username: true },
    });
  }
  throw new Error("Could not find a free username for the SSO user");
}

/**
 * The Auth.js signIn callback for the OIDC provider. Returns true to sign in
 * (the jwt callback then resolves the user via UserIdentity), or a URL to
 * redirect to without signing in (errors, or a link done from Settings).
 */
export async function handleSsoSignIn(
  profile: Record<string, unknown> | undefined,
  currentUserId: () => Promise<string | null>,
): Promise<true | string> {
  const config = ssoConfig();
  if (!config) return "/login?error=Configuration";
  const claims = claimsFromProfile(profile);

  let linkTo: SsoCandidate | null = null;
  const intent = await takeLinkIntent();
  // The link cookie only counts while the same user is still signed in.
  if (intent && intent === (await currentUserId())) linkTo = await candidate({ id: intent });

  const linkedIdentity = claims
    ? await prisma.userIdentity.findUnique({
        where: { provider_subject: { provider: SSO_PROVIDER_ID, subject: claims.subject } },
        select: { userId: true },
      })
    : null;
  const linked = linkedIdentity ? await candidate({ id: linkedIdentity.userId }) : null;
  const emailMatches =
    !linkTo && !linked && claims?.email && claims.emailVerified ? await emailCandidates(claims.email) : [];
  const usernameMatch =
    !linkTo && !linked && config.matchUsername && claims?.username
      ? await candidate({ username: claims.username.toLowerCase() })
      : null;
  const activeAdminCount = await prisma.user.count({ where: { role: "admin", deactivatedAt: null } });

  const decision = decideSsoSignIn({
    claims,
    config,
    linked,
    linkTo,
    emailMatches,
    usernameMatch,
    activeAdminCount,
  });
  const base = linkTo ? "/settings?sso=" : "/login?error=";

  if (decision.kind === "deny") return `${base}${decision.error}`;
  if (!claims) return `${base}SsoInvalidProfile`;

  if (decision.kind === "create") {
    const user = await createSsoUser(claims, decision.role);
    const actor = { id: user.id, name: user.username };
    await audit({ action: "user.create", actor, target: { type: "user", id: user.id, name: user.username }, details: { via: "sso", role: decision.role } });
    await audit({ action: "sso.login", actor, details: { subject: claims.subject, created: true } });
    return true;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: decision.userId }, select: { id: true, username: true, role: true } });
  const actor = { id: user.id, name: user.username };

  if (decision.kind === "link") {
    await prisma.userIdentity.upsert({
      where: { provider_subject: { provider: SSO_PROVIDER_ID, subject: claims.subject } },
      update: {},
      create: { userId: user.id, provider: SSO_PROVIDER_ID, subject: claims.subject, email: claims.email },
    });
    await audit({ action: "sso.link", actor, target: { type: "user", id: user.id, name: user.username }, details: { subject: claims.subject, email: claims.email, auto: decision.auto } });
    if (!decision.auto) return "/settings?sso=linked";
  }

  if (decision.role && decision.role !== user.role) {
    await prisma.user.update({ where: { id: user.id }, data: { role: decision.role } });
    await audit({ action: "user.role", actor, target: { type: "user", id: user.id, name: user.username }, details: { from: user.role, to: decision.role, via: "sso" } });
  }
  await audit({ action: "sso.login", actor, details: { subject: claims.subject } });
  return true;
}

/** The Kanbun user an SSO subject is linked to, for the jwt callback. */
export async function resolveSsoUser(subject: string) {
  const identity = await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider: SSO_PROVIDER_ID, subject } },
    select: { user: { select: { id: true, sessionVersion: true, deactivatedAt: true } } },
  });
  if (!identity || identity.user.deactivatedAt) return null;
  return identity.user;
}
