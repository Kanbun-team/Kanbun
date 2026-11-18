// Outgoing webhooks: event names, payload signing and the address checks that
// keep deliveries away from the server's own network (SSRF). Pure helpers;
// the queue and the HTTP client live in src/server/webhooks.ts.

import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const WEBHOOK_EVENTS = [
  "card.created",
  "card.updated",
  "card.moved",
  "card.deleted",
  "comment.created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Sent by the "Send test" button; not something a webhook subscribes to. */
export const TEST_EVENT = "ping";

export const MAX_WEBHOOKS_PER_BOARD = 10;
/** Consecutive failed deliveries after which a webhook is switched off. */
export const WEBHOOK_FAILURE_LIMIT = 10;
/** Deliveries kept per webhook for the "Recent deliveries" list. */
export const WEBHOOK_HISTORY = 20;

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Subscribed events stored as a JSON array; unknown names are dropped. */
export function parseEvents(raw: string | null | undefined): WebhookEvent[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is WebhookEvent => typeof v === "string" && isWebhookEvent(v)) : [];
  } catch {
    return [];
  }
}

/** The value of the X-Kanbun-Signature header: `sha256=<hex HMAC of the raw body>`. */
export function signPayload(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Constant-time check of a signature header against the raw body. */
export function verifySignature(secret: string, body: string, header: string | null | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(signPayload(secret, body));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------------------
// Address checks
// ---------------------------------------------------------------------------

type Range = { base: bigint; bits: number; size: 32 | 128 };

function v4ToBig(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

/** Expands any IPv6 notation (including an embedded dotted IPv4 tail) to a 128-bit number. */
function v6ToBig(ip: string): bigint {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (tail) {
    const v4 = v4ToBig(tail[1]);
    addr = addr.slice(0, -tail[1].length) + ((v4 >> 16n) & 0xffffn).toString(16) + ":" + (v4 & 0xffffn).toString(16);
  }
  const [head, rest] = addr.includes("::") ? addr.split("::") : [addr, null];
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = rest === null ? [] : new Array(8 - left.length - right.length).fill("0");
  const groups = [...left, ...fill, ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || "0", 16)), 0n);
}

function range(cidr: string): Range {
  const [ip, bits] = cidr.split("/");
  const v6 = ip.includes(":");
  return { base: v6 ? v6ToBig(ip) : v4ToBig(ip), bits: Number(bits), size: v6 ? 128 : 32 };
}

function inRange(value: bigint, r: Range): boolean {
  const shift = BigInt(r.size - r.bits);
  return value >> shift === r.base >> shift;
}

// Loopback, private, link-local, carrier-grade NAT, documentation,
// benchmarking, multicast and reserved ranges.
const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].map(range);

const BLOCKED_V6 = [
  "::/128",
  "::1/128",
  "100::/64",
  "2001:db8::/32",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
].map(range);

// IPv6 forms that carry an IPv4 address in their last 32 bits: those are
// judged by the IPv4 address (so ::ffff:127.0.0.1 counts as loopback).
const EMBEDS_V4 = ["::ffff:0:0/96", "::/96", "64:ff9b::/96"].map(range);

/**
 * Whether an IP address is one deliveries must not reach by default:
 * anything that is not a public unicast address. Invalid input counts as
 * blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  if (family === 4) {
    const value = v4ToBig(ip);
    return BLOCKED_V4.some((r) => inRange(value, r));
  }
  if (family === 6) {
    const value = v6ToBig(ip);
    if (BLOCKED_V6.some((r) => inRange(value, r))) return true;
    if (EMBEDS_V4.some((r) => inRange(value, r))) {
      const v4 = value & 0xffffffffn;
      return BLOCKED_V4.some((r) => inRange(v4, r));
    }
    // 6to4 (2002::/16) carries an IPv4 address in bits 16 to 48.
    if (inRange(value, range("2002::/16"))) {
      const v4 = (value >> 80n) & 0xffffffffn;
      return BLOCKED_V4.some((r) => inRange(v4, r));
    }
    return false;
  }
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: "invalid" | "protocol" | "credentials" | "private" };

/**
 * Syntax and literal checks for a webhook URL, done when it is saved and
 * again before every delivery. Host names are resolved and checked at
 * connection time (src/server/webhooks.ts), since DNS answers can change.
 */
export function checkWebhookUrl(raw: string, allowPrivate = false): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (!url.hostname || raw.length > 2000) return { ok: false, reason: "invalid" };
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) return { ok: false, reason: "private" };
    const lower = host.toLowerCase().replace(/\.$/, "");
    if (lower === "localhost" || lower.endsWith(".localhost")) return { ok: false, reason: "private" };
  }
  return { ok: true, url };
}

export function allowPrivateTargets(env: Record<string, string | undefined> = process.env): boolean {
  return env.WEBHOOK_ALLOW_PRIVATE === "1";
}
