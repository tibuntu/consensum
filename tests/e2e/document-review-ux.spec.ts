import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `b2-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByLabel("required approvals").fill("1");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);
  return page.url();
}

async function waitPresence(page: Page) {
  await page
    .waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST", { timeout: 15000 })
    .catch(() => {});
}

async function setEditorText(page: Page, text: string) {
  const ed = page.getByTestId("editor").locator(".cm-content");
  await ed.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await ed.pressSequentially(text);
}

test("owner sees per-reviewer status and an outdated-review signal", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const A = await ctxA.newPage();
  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();

  await register(A, "Olivia");
  const url = await createDoc(A, "Owner review demo", "The cloud setup needs review before launch.");

  // Reviewer B requests changes.
  await register(B, "Blair");
  await B.goto(url);
  await waitPresence(B);
  await B.getByRole("button", { name: "Request changes" }).click();

  // Owner sees Blair listed with their decision and the version reviewed (v1).
  await A.reload();
  const reviewers = A.getByTestId("reviewers");
  await expect(reviewers).toContainText("Blair");
  await expect(reviewers).toContainText("Changes requested");
  await expect(reviewers).toContainText("v1");

  // Owner addresses feedback with a new version; Blair's change-request persists
  // (only approvals are cleared by a new version) and is now flagged outdated.
  await A.getByRole("button", { name: "Edit" }).click();
  await setEditorText(A, "Revised after addressing the feedback.");
  await A.getByRole("button", { name: "Save" }).click();
  await expect(A.getByRole("button", { name: "Edit" })).toBeVisible();
  await A.reload();
  await expect(A.getByTestId("reviewers")).toContainText("outdated");

  await ctxA.close();
  await ctxB.close();
});

test("comment threads collapse the reply box until Reply is clicked", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, "Cora");
  await createDoc(page, "Reply UX", "The cloud setup needs review before launch.");

  // Owner comments on their own document to create a thread.
  await page.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await page.getByLabel("comment").fill("Which provider?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByTestId("thread")).toContainText("Which provider?");

  // The reply composer is collapsed until the thread's Reply button is clicked.
  await expect(page.getByLabel("reply")).toHaveCount(0);
  await page.getByTestId("thread").getByRole("button", { name: "Reply" }).click();
  await expect(page.getByLabel("reply")).toBeVisible();

  await ctx.close();
});
