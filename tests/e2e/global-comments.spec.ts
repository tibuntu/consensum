import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `gc-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("add, display, and resolve a general (document-scoped) comment", async ({ page }) => {
  await register(page, "Owner");

  await page.getByLabel("title").fill("Infra Plan");
  await page.getByLabel("markdown").fill("The cloud setup needs review before launch.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);

  // Composer is available without selecting text.
  await page.getByTestId("add-general-comment").click();
  await page.getByLabel("general comment").fill("Overall: missing a rollback strategy.");
  await page.getByTestId("general-severity").selectOption("BLOCKER");
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  // Thread lands in the General group, marked document-wide, with no text highlight.
  const generalSection = page.getByTestId("general-section");
  await expect(generalSection.getByTestId("thread")).toContainText("missing a rollback strategy");
  await expect(generalSection.getByTestId("thread")).toContainText("Whole document");
  await expect(page.locator("mark[data-annotation-id]")).toHaveCount(0);
  await expect(page.getByTestId("orphaned-section")).toHaveCount(0);

  // Full thread parity: resolve and reopen.
  await generalSection.getByRole("button", { name: "Resolve" }).click();
  await expect(generalSection.getByRole("button", { name: "Reopen" })).toBeVisible();
});
