import { t, type Locale } from "@/lib/i18n";

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
      return "bg-ink-muted";
    case "high":
      return "bg-warning";
    case "critical":
      return "bg-danger";
    case "normal":
    default:
      return "bg-accent";
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
    ? "bg-accent-soft text-accent"
    : "bg-ink/5 text-ink-muted";
}

export function boardRoleLabel(role: string, locale: Locale): string {
  return role === "owner" ? t("boardOwner", locale) : t("boardMember", locale);
}

export function statusLabel(done: boolean, locale: Locale): string {
  return done ? t("yes", locale) : t("no", locale);
}
