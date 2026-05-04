export type DeviceType = "web" | "mobile" | "desktop";

export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function detectDeviceType(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "web";
  const ua = userAgent.toLowerCase();
  if (ua.includes("electron") || ua.includes("tauri")) return "desktop";
  if (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    ua.includes("android") ||
    ua.includes("mobile")
  ) {
    return "mobile";
  }
  return "web";
}

export function isOnline(lastSeen: Date | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS;
}
