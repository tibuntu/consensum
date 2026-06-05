import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<string> {
  const email = `ver-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Versioner");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

async function setEditorText(page: Page, text: string) {
  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await editor.type(text);
}

test("edit re-anchors (moved) and resets approval", async ({ page }) => {
  await register(page);
  await page.getByLabel("title").fill("Versioned Doc");
  await page.getByLabel("markdown").fill("The quick brown fox jumps over the lazy dog.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);

  await page.getByTestId("doc-body").getByText("brown fox").first().selectText();
  await page.getByLabel("comment").fill("which fox?");
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator('mark[data-annotation-id]')).toHaveCount(1);

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("doc-state")).toHaveText("Approved");

  await page.getByRole("button", { name: "Edit" }).click();
  await setEditorText(page, "The quick brown wolf jumps over the lazy dog.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("doc-state")).toHaveText("Open");
  await expect(page.locator('mark[data-status="MOVED"]')).toHaveCount(1);
});

test("comments propagate live between two clients", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.getByLabel("title").fill("Live Doc");
  await pageA.getByLabel("markdown").fill("Shared content for live updates.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\//);
  const url = pageA.url();

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(url);
  await expect(pageB.getByTestId("doc-body")).toContainText("Shared content");

  await pageA.getByTestId("doc-body").getByText("Shared content").first().selectText();
  await pageA.getByLabel("comment").fill("hello from A");
  await pageA.getByRole("button", { name: "Comment" }).click();

  await expect(pageB.getByTestId("thread")).toContainText("hello from A", { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
