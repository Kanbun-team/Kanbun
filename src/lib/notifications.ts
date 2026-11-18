// Server-only notification helpers. Do NOT import from client components: this
// pulls in the Prisma client. The mutating server actions (mark read) live in
// the actions module; these are plain async helpers called from other server
// code. Types, preferences and recipient resolution are in
// notification-prefs.ts (pure, shared with the client).

import { prisma } from "@/lib/db-local";
import { publishUser } from "@/lib/realtime";
import { t, isLocale, type Locale } from "@/lib/i18n";
import {
  notificationText,
  parseNotificationData,
  parsePrefs,
  planDeliveries,
  type Candidate,
  type NotificationData,
  type NotificationPrefs,
  type NotificationType,
} from "@/lib/notification-prefs";
import { appBaseUrl, emailEnabled, escapeHtml, htmlLayout, queueEmail } from "@/server/email";

export type { NotificationType } from "@/lib/notification-prefs";

export interface NotifyInput {
  recipientId: string;
  type: NotificationType;
  cardTitle: string;
  cardId?: string | null;
  boardId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  /** Extra message text: destination column, number of cards, checklist item. */
  data?: NotificationData | null;
}

/** What happened, without the recipients. */
export type NotifyEvent = Omit<NotifyInput, "recipientId" | "type">;

export function cardUrl(boardId: string | null | undefined, cardId: string | null | undefined): string {
  const base = appBaseUrl();
  if (boardId && cardId) return `${base}/tasks/${boardId}/cards/${cardId}`;
  return boardId ? `${base}/tasks/${boardId}` : `${base}/tasks`;
}

function notificationEmail(to: string, locale: Locale, event: NotifyEvent, type: NotificationType) {
  const message = notificationText({ type, actorName: event.actorName, cardTitle: event.cardTitle, data: event.data }, locale);
  const link = cardUrl(event.boardId, event.cardId);
  const settings = `${appBaseUrl()}/settings`;
  return {
    to,
    subject: message,
    text: `${message}\n\n${t("emailOpenCard", locale)}: ${link}\n\n${t("emailManagePrefs", locale)}: ${settings}\n`,
    html: htmlLayout(
      `<p>${escapeHtml(message)}</p>` +
        `<p><a href="${escapeHtml(link)}">${escapeHtml(t("emailOpenCard", locale))}</a></p>` +
        `<p style="font-size:13px"><a href="${escapeHtml(settings)}">${escapeHtml(t("emailManagePrefs", locale))}</a></p>`
    ),
  };
}

/**
 * Delivers one event to its candidate recipients: at most one notification
 * per person (the most specific type they have not switched off), never to
 * the actor or to deactivated accounts, plus an email where the person asked
 * for one. Email goes out in the background. Never throws: the action that
 * caused the event has already been saved, so a failure here is only logged.
 */
export async function dispatchNotifications(event: NotifyEvent, candidates: Candidate[]): Promise<void> {
  try {
    await deliver(event, candidates);
  } catch (err) {
    console.error("[notifications] delivery failed", err);
  }
}

async function deliver(event: NotifyEvent, candidates: Candidate[]): Promise<void> {
  const ids = [...new Set(candidates.map((c) => c.userId))].filter((id) => id && id !== event.actorId);
  if (ids.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, deactivatedAt: null },
    select: { id: true, email: true, locale: true, notificationPrefs: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const prefs = new Map<string, NotificationPrefs>(users.map((u) => [u.id, parsePrefs(u.notificationPrefs)]));
  const deliveries = planDeliveries(
    candidates.filter((c) => byId.has(c.userId)),
    event.actorId,
    (id) => prefs.get(id)
  );
  if (deliveries.length === 0) return;
  await prisma.notification.createMany({
    data: deliveries.map((d) => ({
      userId: d.userId,
      type: d.type,
      cardId: event.cardId ?? null,
      cardTitle: event.cardTitle,
      boardId: event.boardId ?? null,
      actorId: event.actorId ?? null,
      actorName: event.actorName ?? null,
      data: event.data && Object.keys(event.data).length ? JSON.stringify(event.data) : null,
    })),
  });
  const mail = emailEnabled();
  for (const d of deliveries) {
    publishUser(d.userId);
    const user = byId.get(d.userId);
    if (mail && d.email && user?.email) {
      queueEmail(notificationEmail(user.email, isLocale(user.locale) ? user.locale : "en", event, d.type));
    }
  }
}

export async function notify(input: NotifyInput): Promise<void> {
  await notifyMany([input]);
}

/** Inputs about the same card and actor count as one event (deduplicated). */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  const groups = new Map<string, { event: NotifyEvent; candidates: Candidate[] }>();
  for (const i of inputs) {
    const key = JSON.stringify([i.cardId ?? null, i.boardId ?? null, i.actorId ?? null, i.cardTitle, i.data ?? null]);
    let g = groups.get(key);
    if (!g) {
      g = {
        event: { cardTitle: i.cardTitle, cardId: i.cardId, boardId: i.boardId, actorId: i.actorId, actorName: i.actorName, data: i.data },
        candidates: [],
      };
      groups.set(key, g);
    }
    g.candidates.push({ userId: i.recipientId, type: i.type });
  }
  for (const g of groups.values()) await dispatchNotifications(g.event, g.candidates);
}

/** Extract unique, lowercased @usernames from a comment body. */
export function parseMentions(body: string): string[] {
  const set = new Set<string>();
  // Not preceded by a word char, so "jan@example.com" is not a mention.
  const re = /(?<![a-z0-9_])@([a-z0-9_.-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // Usernames may contain "." and "-", but not as sentence punctuation:
    // "Thanks @bob." mentions "bob".
    const name = m[1].replace(/[.-]+$/, "").toLowerCase();
    if (name) set.add(name);
  }
  return [...set];
}

export interface NotificationView {
  id: string;
  type: string;
  read: boolean;
  createdAt: string;
  cardId: string | null;
  cardTitle: string;
  boardId: string | null;
  actorName: string | null;
  data: NotificationData;
}

export async function getNotifications(
  userId: string
): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      read: r.read,
      createdAt: r.createdAt.toISOString(),
      cardId: r.cardId,
      cardTitle: r.cardTitle,
      boardId: r.boardId,
      actorName: r.actorName,
      data: parseNotificationData(r.data),
    })),
    unread,
  };
}
