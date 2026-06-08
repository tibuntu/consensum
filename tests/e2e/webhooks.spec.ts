import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";

async function register(page: Page): Promise<void> {
  const email = `wh-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Hooker");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

interface Received { headers: Record<string, string | string[] | undefined>; body: string; }

function startSink(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { received.push({ headers: req.headers as Record<string, string | string[] | undefined>, body }); res.writeHead(200); res.end("ok"); });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0, received });
    });
  });
}

test("signed webhook delivery on approval", async ({ browser }) => {
  const { server, port, received } = await startSink();
  try {
    // Owner A owns the webhook and the document; a non-owner participant B
    // supplies the approval (owners can't review their own document, M4-P1).
    const ctxA = await browser.newContext();
    const page = await ctxA.newPage();
    await register(page);

    // Register the webhook via the settings UI.
    await page.goto("/app/settings/webhooks");
    await page.getByLabel("webhook url").fill(`http://127.0.0.1:${port}/sink`);
    await page.getByLabel("decision.changed").check();
    await page.getByRole("button", { name: "Create webhook" }).click();
    const secret = await page.getByTestId("new-webhook-secret").inputValue();
    expect(secret.startsWith("whsec_")).toBe(true);

    // Create a plan → reviewer B approves it → triggers decision.changed.
    await page.goto("/app");
    await page.getByLabel("title").fill("Webhook Plan");
    await page.getByLabel("markdown").fill("Content to approve.");
    await page.getByRole("button", { name: "Create document" }).click();
    await expect(page).toHaveURL(/\/app\/documents\//);
    const url = page.url();

    // Reviewer B joins via link-grant and approves.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await register(pageB);
    await pageB.goto(url);
    await expect(pageB.getByTestId("doc-body")).toContainText("Content to approve");
    await pageB.getByRole("button", { name: "Approve" }).click();

    // Wait for the outbox worker to deliver the webhook (OUTBOX_POLL_MS=500ms).
    await expect.poll(() => received.length, { timeout: 15_000 }).toBeGreaterThan(0);

    // Find the decision.changed hit.
    const hit = received.find((r) => {
      try { return JSON.parse(r.body).event === "decision.changed"; }
      catch { return false; }
    });
    expect(hit).toBeTruthy();

    // Verify the HMAC signature.
    const expected = `sha256=${createHmac("sha256", secret).update(hit!.body).digest("hex")}`;
    expect(hit!.headers["x-quorum-signature"]).toBe(expected);
    expect(hit!.headers["x-quorum-event"]).toBe("decision.changed");
    expect(hit!.headers["x-quorum-timestamp"]).toBeTruthy();

    // A wrong secret must NOT produce the same signature.
    const forged = `sha256=${createHmac("sha256", "whsec_wrong").update(hit!.body).digest("hex")}`;
    expect(forged).not.toBe(hit!.headers["x-quorum-signature"]);
  } finally {
    server.close();
  }
});
