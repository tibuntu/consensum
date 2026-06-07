import { prisma } from "@/lib/db";

/** True for loopback / link-local / private-range literal IPs (v4 + minimal v6). */
export function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;          // loopback, this-host, private
  if (a === 169 && b === 254) return true;                    // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 192 && b === 168) return true;                    // private
  return false;
}

/**
 * SSRF guard. In production: require https + reject loopback/link-local/private hosts
 * (literal IPs and well-known names). Outside production: permissive (http+localhost ok)
 * so the e2e sink works. `WEBHOOK_ALLOW_INSECURE=true` bypasses entirely (tests / self-host
 * pointing at internal services). Throws on rejection.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("invalid URL"); }
  if (process.env.WEBHOOK_ALLOW_INSECURE === "true") return;
  if (process.env.NODE_ENV !== "production") return;
  if (parsed.protocol !== "https:") throw new Error("webhook URL must use https");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("webhook URL host not allowed");
  }
  if (isPrivateIp(host)) throw new Error("webhook URL host not allowed");
}
