import { t, type Locale, type DictKey } from "@/lib/i18n";

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function priorityLabel(p: string, locale: Locale): string {
  switch (p) {
    case "low":
      return t("priorityLow", locale);
    case "high":
      return t("priorityHigh", locale);
    case "critical":
      return t("priorityCritical", locale);
    case "normal":
    default:
      return t("priorityNormal", locale);
  }
}

export function priorityClass(p: string): string {
  switch (p) {
    case "low":
      return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
    case "high":
      return "bg-orange-200 text-orange-900 dark:bg-orange-700/40 dark:text-orange-200";
    case "critical":
      return "bg-red-200 text-red-900 dark:bg-red-700/40 dark:text-red-200";
    case "normal":
    default:
      return "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200";
  }
}

export const ROLES = ["member", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function asAppRole(role: string): Role {
  return role === "admin" ? "admin" : "member";
}

export function roleFullLabel(role: string, locale: Locale): string {
  return asAppRole(role) === "admin" ? t("roleAdmin", locale) : t("roleMember", locale);
}

export function roleBadgeClass(role: string): string {
  return asAppRole(role) === "admin"
    ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function boardRoleLabel(role: string, locale: Locale): string {
  return role === "owner" ? t("boardOwner", locale) : t("boardMember", locale);
}

export function statusLabel(done: boolean, locale: Locale): string {
  return done ? t("yes", locale) : t("no", locale);
}
