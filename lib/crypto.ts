import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

// Reversible at-rest storage for webhook signing secrets. We are the signer, so a
// one-way hash is impossible — we encrypt with an app key when present, else store
// plaintext with a version marker so dev/CI can run keyless. Format:
//   "v1:<iv_b64url>:<tag_b64url>:<ct_b64url>"  (AES-256-GCM)
//   "v0:<plaintext>"                            (no key configured)
function key(): Buffer | null {
  const raw = process.env.WEBHOOK_SECRET_KEY;
  if (!raw) return null;
  return scryptSync(raw, "consensum-webhook-secret", 32);
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) return `v0:${plain}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

export function decryptSecret(enc: string): string {
  if (enc.startsWith("v0:")) return enc.slice(3);
  if (enc.startsWith("v1:")) {
    const k = key();
    if (!k) throw new Error("WEBHOOK_SECRET_KEY required to decrypt a v1 secret");
    const [, ivB64, tagB64, ctB64] = enc.split(":");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  }
  throw new Error("unrecognized secret format");
}
