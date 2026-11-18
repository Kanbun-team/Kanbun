// Job: daily digest. Users who turned it on (and have an email address) get
// one email a day listing the notifications that arrived since the previous
// digest and are still unread. Nothing is sent when there are none, or when
// SMTP is not configured.

import { prisma } from "@/lib/db-local";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { notificationText } from "@/lib/notification-prefs";
import { cardUrl } from "@/lib/notifications";
import { appBaseUrl, emailEnabled, escapeHtml, htmlLayout, queueEmail, type EmailMessage } from "@/server/email";

const DAY = 24 * 60 * 60 * 1000;
// The job runs hourly; a little slack keeps the send time from drifting later.
const MIN_GAP = DAY - 30 * 60 * 1000;
const MAX_ITEMS = 50;

export interface DigestItem {
  type: string;
  cardTitle: string;
  actorName: string | null;
  cardId: string | null;
  boardId: string | null;
}

export function buildDigestEmail(to: string, items: DigestItem[], locale: Locale): EmailMessage {
  const shown = items.slice(0, MAX_ITEMS);
  const lines = shown.map((n) => ({ text: notificationText(n, locale), url: cardUrl(n.boardId, n.cardId) }));
  const subject = t("digestSubject", locale).replace("{count}", String(items.length));
  const more = items.length > shown.length ? t("digestMore", locale).replace("{count}", String(items.length - shown.length)) : "";
  const inbox = `${appBaseUrl()}/tasks`;
  const settings = `${appBaseUrl()}/settings`;
  const text = [
    subject,
    "",
    ...lines.map((l) => `- ${l.text}\n  ${l.url}`),
    ...(more ? ["", more] : []),
    "",
    `${t("emailManagePrefs", locale)}: ${settings}`,
  ].join("\n");
  const html = htmlLayout(
    `<h1 style="font-size:18px">${escapeHtml(subject)}</h1><ul>` +
      lines.map((l) => `<li style="margin-bottom:6px"><a href="${escapeHtml(l.url)}">${escapeHtml(l.text)}</a></li>`).join("") +
      `</ul>` +
      (more ? `<p>${escapeHtml(more)}</p>` : "") +
      `<p><a href="${escapeHtml(inbox)}">Kanbun</a> · <a href="${escapeHtml(settings)}">${escapeHtml(t("emailManagePrefs", locale))}</a></p>`
  );
  return { to, subject, text, html };
}

export async function runDigest(now: Date = new Date()): Promise<number> {
  if (!emailEnabled()) return 0;
  const users = await prisma.user.findMany({
    where: {
      digestEnabled: true,
      deactivatedAt: null,
      email: { not: null },
      OR: [{ digestSentAt: null }, { digestSentAt: { lte: new Date(now.getTime() - MIN_GAP) } }],
    },
    select: { id: true, email: true, locale: true, digestSentAt: true },
  });
  let sent = 0;
  for (const u of users) {
    const since = u.digestSentAt ?? new Date(now.getTime() - DAY);
    const items = await prisma.notification.findMany({
      where: { userId: u.id, read: false, createdAt: { gt: since, lte: now } },
      orderBy: { createdAt: "desc" },
      select: { type: true, cardTitle: true, actorName: true, cardId: true, boardId: true },
    });
    await prisma.user.update({ where: { id: u.id }, data: { digestSentAt: now } });
    if (items.length === 0 || !u.email) continue;
    queueEmail(buildDigestEmail(u.email, items, isLocale(u.locale) ? u.locale : "en"));
    sent++;
  }
  return sent;
}
