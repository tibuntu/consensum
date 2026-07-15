import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `gs-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Newcomer");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("fresh user sees the getting-started card and its token link works", async ({ page }) => {
  await register(page);
  const card = page.getByTestId("getting-started");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Create an API token");
  await expect(card).toContainText("CONSENSUM_BASE_URL");
  await expect(card).toContainText("/consensum-push-plan");

  await card.getByRole("link", { name: "Create an API token" }).click();
  await expect(page).toHaveURL(/\/settings\/tokens/);
  await expect(page.getByLabel("token label")).toBeVisible();
});

test("card disappears once a document exists", async ({ page }) => {
  await register(page);
  await expect(page.getByTestId("getting-started")).toBeVisible();

  await page.getByLabel("title").fill("First Plan");
  await page.getByLabel("markdown").fill("A plan body.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);

  await page.goto("/");
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await expect(page.getByText("First Plan")).toBeVisible();
});
