import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `na-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("inbox names who acted on the document", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const A = await ctxA.newPage();
  await register(A, "Olivia");
  await A.getByLabel("title").fill("Notify Plan");
  await A.getByLabel("markdown").fill("Shared content needing review.");
  await A.getByRole("button", { name: "Create document" }).click();
  await expect(A).toHaveURL(/\/app\/documents\//);
  const url = A.url();

  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();
  await register(B, "Blair");
  await B.goto(url);
  await B.getByTestId("doc-body").getByText("Shared content").first().selectText();
  await B.getByLabel("comment").fill("a question from Blair");
  await B.getByRole("button", { name: "Comment" }).click();
  await expect(B.getByTestId("thread")).toContainText("a question from Blair");

  await A.goto("/app/inbox");
  await expect(A.getByTestId("notification").first()).toContainText("Blair commented");

  await ctxA.close();
  await ctxB.close();
});
