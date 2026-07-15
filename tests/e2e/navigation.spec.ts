import { test, expect } from "@playwright/test";

test("nav reaches settings and inbox", async ({ page }) => {
  const email = `nav-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Nav User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/tokens/);
  await expect(page.getByLabel("token label")).toBeVisible();
  // Top-level Settings tab stays highlighted on settings sub-pages.
  await expect(page.getByTestId("settings-link")).toHaveClass(/text-primary/);

  // Settings sub-nav reaches notification preferences.
  await page.getByTestId("settings-subnav").getByRole("link", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/\/settings\/notifications/);
  await expect(page.getByTestId("pref-comment-email")).toBeVisible();
  await expect(page.getByTestId("settings-link")).toHaveClass(/text-primary/);

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByTestId("inbox-link").click();
  await expect(page).toHaveURL(/\/inbox/);
});

test("landing page shows for logged-out visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});
