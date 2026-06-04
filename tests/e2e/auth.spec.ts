import { test, expect } from "@playwright/test";

test("register, see home, logout, blocked again", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/register");
  await page.getByLabel("name").fill("E2E User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTestId("current-user")).toHaveText(email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
