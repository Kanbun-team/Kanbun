// Optional outgoing email over SMTP (nodemailer). Configured with SMTP_URL
// (e.g. smtp://user:pass@host:587) and SMTP_FROM. Without SMTP_URL email is
// disabled and every send is a no-op. Sending never blocks or fails the
// caller: messages go out in the background and errors are only logged.

import type { Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailEnabled(): boolean {
  return !!process.env.SMTP_URL?.trim();
}

/** Public base URL for links in emails, without a trailing slash. */
export function appBaseUrl(): string {
  const raw = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

const globalForMail = globalThis as unknown as { __kanbunMailer?: Promise<Transporter> };

async function transporter(): Promise<Transporter> {
  if (!globalForMail.__kanbunMailer) {
    globalForMail.__kanbunMailer = import("nodemailer").then((m) => m.default.createTransport(process.env.SMTP_URL!));
  }
  return globalForMail.__kanbunMailer;
}

/** Sends and resolves when done; rejects on failure. Prefer queueEmail. */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!emailEnabled()) return;
  const mailer = await transporter();
  await mailer.sendMail({
    from: process.env.SMTP_FROM || "Kanbun <kanbun@localhost>",
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

/** Fire and forget: never throws, never delays the caller. */
export function queueEmail(msg: EmailMessage): void {
  if (!emailEnabled()) return;
  setTimeout(() => {
    sendEmail(msg).catch((err) => console.error("[email] sending failed", err));
  }, 0);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A minimal HTML layout shared by notification and digest emails. */
export function htmlLayout(bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2328;max-width:560px;margin:0 auto;padding:16px">${bodyHtml}<p style="color:#656d76;font-size:12px;margin-top:24px">Kanbun</p></body></html>`;
}
