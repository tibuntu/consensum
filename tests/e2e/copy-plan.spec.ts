import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `cpy-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("copy plan button writes the raw markdown to the clipboard", async ({ browser }) => {
  // Grant clipboard access so we can read back what the button copied.
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await register(page, "Author");

  const planBody = "# Migration Plan\n\nStep one: provision the cluster.\n\n- [ ] task A\n- [ ] task B";
  await page.getByLabel("title").fill("Copyable Plan");
  await page.getByLabel("markdown").fill(planBody);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);

  const copyButton = page.getByTestId("copy-plan");
  await expect(copyButton).toHaveText("Copy");
  await copyButton.click();

  // Visual confirmation flips to "Copied!".
  await expect(copyButton).toHaveText("Copied!");

  // Clipboard holds the raw markdown, not the rendered HTML.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(planBody);

  await ctx.close();
});
