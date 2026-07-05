import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random()*1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("blocker gate holds approval until the thread resolves", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const reviewerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const reviewer = await reviewerCtx.newPage();

  await register(owner, "Gwen");
  await register(reviewer, "Rex");

  await owner.goto("/");
  await owner.getByLabel("title").fill("Gated plan");
  await owner.getByLabel("markdown").fill("# Plan\n\nReview this.");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/documents\//);
  const url = owner.url();
  const docId = url.split("/documents/")[1].split(/[/?#]/)[0];

  // Owner opts into the gate.
  const gateSaved = owner.waitForResponse((r) => r.url().includes("/settings") && r.request().method() === "PATCH");
  await owner.getByTestId("require-blocker-resolution").check();
  expect((await gateSaved).ok()).toBeTruthy();

  // Reviewer becomes a participant, then raises a document-scoped BLOCKER via the session API.
  await reviewer.goto(url);
  await reviewer.waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST");
  const annRes = await reviewerCtx.request.post(`/api/documents/${docId}/annotations`, {
    data: { scope: "document", body: "Missing rollback plan", severity: "BLOCKER" },
  });
  expect(annRes.status()).toBe(201);
  const { annotation } = await annRes.json();

  // Approval lands but the gate holds the state at Changes requested.
  const approved = reviewer.waitForResponse((r) => r.url().includes("/reviews") && r.request().method() === "POST");
  await reviewer.getByRole("button", { name: "Approve" }).click();
  expect((await approved).ok()).toBeTruthy();
  await reviewer.reload();
  await expect(reviewer.getByTestId("doc-state")).toHaveText("Changes requested");

  // Resolving the blocker releases the approval.
  const resolved = await reviewerCtx.request.patch(`/api/annotations/${annotation.id}`, {
    data: { threadStatus: "RESOLVED", resolution: "FIXED" },
  });
  expect(resolved.ok()).toBeTruthy();
  await reviewer.reload();
  await expect(reviewer.getByTestId("doc-state")).toHaveText("Approved");

  await ownerCtx.close();
  await reviewerCtx.close();
});
