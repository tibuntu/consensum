import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `help-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Helper");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("nav help button opens the getting-started dialog on any page", async ({ page }) => {
  await register(page);

  await page.goto("/inbox");
  await page.getByTestId("help-button").click();
  const dialog = page.getByTestId("help-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("install.sh");
  await expect(dialog).toContainText("CONSENSUM_BASE_URL");
  await expect(dialog).toContainText("/consensum-push-plan");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("help-dialog")).toHaveCount(0);
});
