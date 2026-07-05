import { test, expect, type Page } from "@playwright/test";

// Register a fresh user and land on an authed page that renders AppNav (mirrors
// tests/e2e/navigation.spec.ts).
async function login(page: Page) {
  const email = `theme-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Theme User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

// The single theme button cycles light → dark → system → light. Click it until
// it reports the desired choice via data-theme-choice, so tests stay independent
// of the starting state.
async function selectTheme(page: Page, target: "light" | "dark" | "system") {
  const toggle = page.getByTestId("theme-toggle");
  for (let i = 0; i < 3; i++) {
    if ((await toggle.getAttribute("data-theme-choice")) === target) return;
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-theme-choice", target);
}

test("theme toggle persists and applies", async ({ page }) => {
  await login(page);

  await selectTheme(page, "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/); // persisted, no flash

  await selectTheme(page, "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("system mode follows emulated OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);

  await selectTheme(page, "system");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
