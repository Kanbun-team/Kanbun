// Notification types, per-user delivery preferences and recipient resolution.
// Pure functions only (no Prisma), so client components and tests can import
// this module.
//
// Preference model: for every notification type a user picks one channel.
//   "inapp" (default): the notification appears in the bell.
//   "email": the bell AND an email (email always implies in-app).
//   "none":  nothing for this type.
// Email is only sent when SMTP is configured and the user has an address;
// otherwise "email" behaves like "inapp".

import { t, tn, type DictKey, type Locale } from "@/lib/i18n";

export const NOTIFICATION_TYPES = [
  "assigned",
  "subtaskAssigned",
  "mention",
  "comment",
  "moved",
  "dueSoon",
  "blocked",
  "newCard",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CHANNELS = ["inapp", "email", "none"] as const;
export type Channel = (typeof CHANNELS)[number];

export type NotificationPrefs = Record<NotificationType, Channel>;

export const DEFAULT_CHANNEL: Channel = "inapp";

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

/** Reads the JSON stored on User.notificationPrefs; unknown or bad values fall back to in-app. */
export function parsePrefs(raw: string | null | undefined): NotificationPrefs {
  let obj: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch {
    obj = {};
  }
  const prefs = {} as NotificationPrefs;
  for (const type of NOTIFICATION_TYPES) {
    const v = obj[type];
    prefs[type] = isChannel(v) ? v : DEFAULT_CHANNEL;
  }
  return prefs;
}

export function serializePrefs(prefs: Partial<Record<string, unknown>>): string {
  const out: Partial<NotificationPrefs> = {};
  for (const type of NOTIFICATION_TYPES) {
    const v = prefs[type];
    // Only store what differs from the default, so new types start in-app.
    if (isChannel(v) && v !== DEFAULT_CHANNEL) out[type] = v;
  }
  return JSON.stringify(out);
}

// When one event reaches a user through several paths (mentioned in a comment
// on a card they watch, assigned and watching), they get the most specific
// type. Earlier in this list wins.
const PRIORITY: NotificationType[] = ["mention", "assigned", "subtaskAssigned", "blocked", "dueSoon", "moved", "comment", "newCard"];

export interface Candidate {
  userId: string;
  type: NotificationType;
}

export interface Delivery {
  userId: string;
  type: NotificationType;
  email: boolean;
}

/**
 * Resolves the candidates of one event into at most one delivery per user:
 * never the actor, the most specific type the user has not switched off, and
 * whether an email goes out too. `prefsFor` returns a user's preferences
 * (missing users get the defaults).
 */
export function planDeliveries(
  candidates: Candidate[],
  actorId: string | null | undefined,
  prefsFor: (userId: string) => NotificationPrefs | undefined
): Delivery[] {
  const byUser = new Map<string, Set<NotificationType>>();
  for (const c of candidates) {
    if (!c.userId || (actorId && c.userId === actorId)) continue;
    let set = byUser.get(c.userId);
    if (!set) byUser.set(c.userId, (set = new Set()));
    set.add(c.type);
  }
  const out: Delivery[] = [];
  for (const [userId, types] of byUser) {
    const prefs = prefsFor(userId) ?? parsePrefs(null);
    const type = PRIORITY.find((t) => types.has(t) && prefs[t] !== "none");
    if (!type) continue;
    out.push({ userId, type, email: prefs[type] === "email" });
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Deadlines are calendar dates stored as UTC midnight, due by the end of that
 * day. A card is "due soon" when the end of its deadline day has not passed
 * yet and the day starts within the next 24 hours (so: due today or tomorrow).
 */
export function isDueSoon(deadline: Date, now: Date = new Date()): boolean {
  const start = deadline.getTime();
  const end = start + DAY;
  return end > now.getTime() && start <= now.getTime() + DAY;
}

/** i18n key of the bell/email text for a type; {actor} and {card} are substituted. */
export function messageKey(type: string): DictKey {
  switch (type) {
    case "assigned":
      return "notifAssigned";
    case "subtaskAssigned":
      return "notifSubtaskAssignedGeneric";
    case "mention":
      return "notifMention";
    case "blocked":
      return "notifBlocked";
    case "comment":
      return "notifComment";
    case "moved":
      return "notifMoved";
    case "dueSoon":
      return "notifDueSoon";
    case "newCard":
      return "notifNewCard";
    default:
      return "notifGeneric";
  }
}

/** Extra message text stored with a notification (Notification.data, JSON). */
export type NotificationData = Partial<Record<"column" | "count" | "board" | "item", string>>;

const DATA_KEYS = ["column", "count", "board", "item"] as const;

export function parseNotificationData(raw: string | null | undefined): NotificationData {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: NotificationData = {};
    for (const key of DATA_KEYS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (typeof v === "string" && v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const quote = (s: string) => `"${s}"`;

/** The bell and email text of a notification, in the reader's language. */
export function notificationText(
  n: { type: string; actorName?: string | null; cardTitle: string; data?: NotificationData | null },
  locale: Locale
): string {
  const actor = n.actorName ?? t("notifSomeone", locale);
  const data = n.data ?? {};
  const count = Number(data.count);
  let text: string;
  if (n.type === "newCard" && count > 1) {
    // Several cards added at once (a pasted list): one notification for all.
    text = tn("notifNewCards", count, locale).replace("{board}", quote(data.board ?? n.cardTitle));
  } else if (n.type === "moved" && data.column) {
    text = t("notifMovedTo", locale).replace("{column}", quote(data.column));
  } else if (n.type === "subtaskAssigned" && data.item) {
    text = t("notifSubtaskAssigned", locale).replace("{item}", quote(data.item));
  } else {
    text = t(messageKey(n.type), locale);
  }
  return text.replace("{actor}", actor).replace("{card}", quote(n.cardTitle));
}

/** i18n key of the type's label in the settings table. */
export function typeLabelKey(type: NotificationType): DictKey {
  const keys: Record<NotificationType, DictKey> = {
    assigned: "notifTypeAssigned",
    subtaskAssigned: "notifTypeSubtaskAssigned",
    mention: "notifTypeMention",
    comment: "notifTypeComment",
    moved: "notifTypeMoved",
    dueSoon: "notifTypeDueSoon",
    blocked: "notifTypeBlocked",
    newCard: "notifTypeNewCard",
  };
  return keys[type];
}
