import { test, expect, type Page } from "@playwright/test";

const NOT_FOUND_TEXT = "This page could not be found.";
const PASSWORD = "correct-horse-battery";

/** Register `email`; on a re-run where the account already exists, fall back to logging in. */
async function loginOrRegister(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  // New account → navigates to "/"; existing account → stays on /register with
  // a role="alert" error. The app has continuous background traffic (presence
  // heartbeat), so "networkidle" never fires — race the two real outcomes instead.
  await Promise.race([page.waitForURL("/"), page.getByRole("alert").waitFor()]);
  if (new URL(page.url()).pathname !== "/") {
    await page.goto("/login");
    await page.getByLabel("email").fill(email);
    await page.getByLabel("password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/$/);
  }
}

/** Register a brand-new unique @example.com user; returns the email. */
async function registerFresh(page: Page, tag: string): Promise<string> {
  const email = `admin-e2e-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(tag);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

test("non-admin cannot reach the admin surface", async ({ page }) => {
  await registerFresh(page, "plain");
  await page.goto("/settings/notifications");
  await expect(page.getByTestId("settings-subnav")).not.toContainText("Admin");
  await page.goto("/settings/admin");
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
});

test("admin manages users and allowlist; deactivated user cannot log in", async ({ browser }) => {
  // Victim registers first (fresh) in their own context.
  const victimCtx = await browser.newContext();
  const victim = await victimCtx.newPage();
  const victimEmail = await registerFresh(victim, "victim");

  // Admin (env-listed email) signs in.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await loginOrRegister(admin, "e2e-admin@example.com", "Admin");

  await admin.goto("/settings/admin");
  await expect(admin.getByTestId("settings-subnav")).toContainText("Admin");
  await expect(admin.getByTestId("admin-page")).toBeVisible();

  // Allowlist: add + remove a domain.
  const domain = `t-${Date.now()}.com`;
  await admin.getByLabel("allowlist entry").fill(domain);
  const added = admin.waitForResponse((r) => r.url().endsWith("/admin/allowlist") && r.request().method() === "POST");
  await admin.getByRole("button", { name: "Add" }).click();
  expect((await added).status()).toBe(201);
  await expect(admin.getByTestId(`allowlist-row-${domain}`)).toBeVisible();
  await admin.getByTestId(`allowlist-row-${domain}`).getByRole("button", { name: "Remove" }).click();
  await expect(admin.getByTestId(`allowlist-row-${domain}`)).toHaveCount(0);

  // Promote the victim (proves setRole wiring).
  const victimRow = admin.getByTestId(`user-row-${victimEmail}`);
  await victimRow.getByRole("button", { name: "Make admin" }).click();
  await expect(victimRow).toContainText("admin");

  // Deactivate the victim.
  await victimRow.getByRole("button", { name: "Deactivate" }).click();
  await expect(victimRow).toContainText("deactivated");

  // Victim's existing session is swept: navigating to a protected page bounces to /login.
  await victim.goto("/settings/tokens");
  await expect(victim).toHaveURL(/\/login/);

  // Victim cannot log back in.
  await victim.getByLabel("email").fill(victimEmail);
  await victim.getByLabel("password").fill(PASSWORD);
  await victim.getByRole("button", { name: "Log in" }).click();
  await expect(victim.getByText(/deactivated/i)).toBeVisible();

  await victimCtx.close();
  await adminCtx.close();
});
