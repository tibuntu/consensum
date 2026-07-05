import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `b3-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("register inputs carry validation + autocomplete attributes", async ({ page }) => {
  await page.goto("/register");
  const email = page.getByLabel("email");
  await expect(email).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("autocomplete", "email");
  const pw = page.getByLabel("password");
  await expect(pw).toHaveAttribute("autocomplete", "new-password");
  await expect(pw).toHaveAttribute("minlength", "8");
});

test("notification settings confirm a successful save", async ({ page }) => {
  await register(page, "Sage");
  await page.goto("/settings/notifications");
  await page.getByTestId("pref-comment-email").click();
  await expect(page.getByRole("status")).toContainText("Saved");
});

test("settings sub-nav marks the active tab", async ({ page }) => {
  await register(page, "Nadia");
  await page.goto("/settings/notifications");
  await expect(page.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "API tokens" })).not.toHaveAttribute("aria-current", "page");
});
