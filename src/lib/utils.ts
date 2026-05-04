import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function safeRedirect(target: string | null | undefined, fallback: string): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}

export function clampString(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
