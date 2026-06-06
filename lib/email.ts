import nodemailer, { type Transporter } from "nodemailer";

export interface Mail { to: string; subject: string; html: string; text: string; }

function fromAddress(): string | undefined {
  return process.env.EMAIL_FROM;
}

export function isEmailConfigured(): boolean {
  if (process.env.EMAIL_TRANSPORT === "json") return !!fromAddress();
  return !!(process.env.SMTP_HOST && fromAddress());
}

let cached: Transporter | null = null;
function transport(): Transporter {
  if (cached) return cached;
  if (process.env.EMAIL_TRANSPORT === "json") {
    cached = nodemailer.createTransport({ jsonTransport: true });
    return cached;
  }
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cached;
}

/** Raw send — assumes configured. Returns nodemailer info (used by tests). */
export async function sendMailRaw(mail: Mail) {
  return transport().sendMail({ from: fromAddress(), ...mail });
}

/** Best-effort send: no-op when unconfigured, never throws. */
export async function sendMail(mail: Mail): Promise<void> {
  if (!isEmailConfigured()) return;
  try { await sendMailRaw(mail); } catch { /* best-effort */ }
}

/** Test hook: reset the cached transporter between env changes. */
export function __resetTransport() { cached = null; }
