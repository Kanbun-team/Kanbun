// Avatar URLs are typed by users and shown to everyone who shares a board, so
// only plain https image URLs are accepted: no javascript: or data: URLs, no
// cleartext http (mixed content, and it reveals who looks at a board to
// anyone on the network), no embedded credentials. The Content-Security-Policy
// (src/lib/csp.ts) allows https: images for the same reason. Client-safe.

export const AVATAR_URL_MAX = 500;

/** The URL when it is a safe https avatar URL, otherwise null. */
export function safeAvatarUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.length > AVATAR_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return value;
}
