import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const KEY = "test-key-please-change";

describe("crypto secret store", () => {
  afterEach(() => { delete process.env.WEBHOOK_SECRET_KEY; });

  it("round-trips with a key (v1)", () => {
    process.env.WEBHOOK_SECRET_KEY = KEY;
    const enc = encryptSecret("whsec_abc123");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("whsec_abc123");
    expect(decryptSecret(enc)).toBe("whsec_abc123");
  });

  it("round-trips keyless (v0 plaintext fallback)", () => {
    const enc = encryptSecret("whsec_xyz");
    expect(enc).toBe("v0:whsec_xyz");
    expect(decryptSecret(enc)).toBe("whsec_xyz");
  });

  it("throws when ciphertext is tampered", () => {
    process.env.WEBHOOK_SECRET_KEY = KEY;
    const enc = encryptSecret("whsec_abc123");
    const parts = enc.split(":"); // v1:iv:tag:ct
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
