import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `copy-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Copier");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

// The one-time API token and webhook signing secret are shown exactly once and
// cannot be re-retrieved — there must be a working copy affordance (F49/F48).

test("API token reveal has a working copy button", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await register(page);
  await page.goto("/settings/tokens");
  await page.getByLabel("token label").fill("ci");
  await page.getByRole("button", { name: "Create token" }).click();

  const token = await page.getByTestId("new-token").inputValue();
  expect(token.startsWith("csm_")).toBe(true);

  // Accessible name stays "Copy"; the visible text flips and a status region announces.
  const copyBtn = page.getByRole("button", { name: "Copy", exact: true });
  await copyBtn.click();
  await expect(copyBtn).toContainText("Copied");
  await expect(page.getByRole("status").filter({ hasText: "Copied to clipboard" })).toHaveCount(1);

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(token);
});

test("webhook secret reveal has a working copy button", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await register(page);
  await page.goto("/settings/webhooks");
  await page.getByLabel("webhook url").fill("http://127.0.0.1:9991/consensum");
  await page.getByRole("button", { name: "Create webhook" }).click();

  const secret = await page.getByTestId("new-webhook-secret").inputValue();
  expect(secret.startsWith("whsec_")).toBe(true);

  const copyBtn = page.getByRole("button", { name: "Copy", exact: true });
  await copyBtn.click();
  await expect(copyBtn).toContainText("Copied");
  await expect(page.getByRole("status").filter({ hasText: "Copied to clipboard" })).toHaveCount(1);

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(secret);
});
