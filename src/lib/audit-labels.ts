import en from "@/locales/en.json";
import { t, type DictKey, type Locale } from "@/lib/i18n";

// Display names for audit log actions and targets. Every action has an
// `audit_<action with dots replaced by underscores>` key; an action without one
// (for example from a newer version) shows its raw name.

export function auditActionKey(action: string): string {
  return `audit_${action.replace(/\./g, "_")}`;
}

function lookup(key: string, raw: string, locale: Locale): string {
  return key in en ? t(key as DictKey, locale) : raw;
}

export function auditActionLabel(action: string, locale: Locale): string {
  return lookup(auditActionKey(action), action, locale);
}

export function auditTargetLabel(type: string, locale: Locale): string {
  return lookup(`auditTarget_${type}`, type, locale);
}
