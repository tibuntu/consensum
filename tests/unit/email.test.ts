import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("email transport", () => {
  const saved = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...saved }; });

  it("isEmailConfigured false when no env", async () => {
    delete process.env.SMTP_HOST; delete process.env.EMAIL_FROM; delete process.env.EMAIL_TRANSPORT;
    const { isEmailConfigured } = await import("../../lib/email");
    expect(isEmailConfigured()).toBe(false);
  });

  it("sendMail no-ops when unconfigured", async () => {
    delete process.env.SMTP_HOST; delete process.env.EMAIL_FROM; delete process.env.EMAIL_TRANSPORT;
    const { sendMail } = await import("../../lib/email");
    await expect(sendMail({ to: "a@b.c", subject: "x", html: "<p>x</p>", text: "x" })).resolves.toBeUndefined();
  });

  it("captures with json transport", async () => {
    process.env.EMAIL_TRANSPORT = "json"; process.env.EMAIL_FROM = "noreply@quorum.test";
    const mod = await import("../../lib/email");
    const info = await mod.sendMailRaw({ to: "a@b.c", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(info).toBeTruthy();
    expect(String(info.message)).toContain("Hi");
  });
});
