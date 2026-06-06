import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `az-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/app");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);
  return page.url();
}

test("web: link-grant, list isolation, owner-only edit, non-participant blocked", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  const urlA = await createDoc(pageA, "A Plan", "The cloud setup needs review.");
  const idA = urlA.split("/app/documents/")[1];

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);

  // B's list does not show A's doc yet.
  await pageB.goto("/app");
  await expect(pageB.getByText("A Plan")).toHaveCount(0);

  // B opens A's doc by URL → auto-joins (link-grant).
  await pageB.goto(urlA);
  await expect(pageB.getByTestId("doc-body")).toContainText("cloud setup");
  // Now it appears in B's list.
  await pageB.goto("/app");
  await expect(pageB.getByText("A Plan")).toBeVisible();

  // B (participant) cannot create a new version: PATCH → 403.
  const patchB = await pageB.request.patch(`/api/documents/${idA}`, {
    data: { markdown: "hijacked", baseVersionNumber: 1 },
  });
  expect(patchB.status()).toBe(403);
  // A (owner) can.
  const patchA = await pageA.request.patch(`/api/documents/${idA}`, {
    data: { markdown: "The cloud setup needs review. v2", baseVersionNumber: 1 },
  });
  expect(patchA.status()).toBe(200);

  // A second doc B has never opened: writes are 404 for B.
  const urlA2 = await createDoc(pageA, "A Secret", "Hidden content here.");
  const idA2 = urlA2.split("/app/documents/")[1];
  const stream = await pageB.request.get(`/api/documents/${idA2}/stream`);
  expect(stream.status()).toBe(404);
  const review = await pageB.request.post(`/api/documents/${idA2}/reviews`, { data: { verdict: "APPROVE" } });
  expect(review.status()).toBe(404);
  const annotate = await pageB.request.post(`/api/documents/${idA2}/annotations`, {
    data: { body: "x", startOffset: 0, endOffset: 6, quote: { exact: "Hidden", prefix: "", suffix: " content" } },
  });
  expect(annotate.status()).toBe(404);

  await ctxA.close();
  await ctxB.close();
});

test("machine: owner-strict + scope + expiry", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.goto("/app/settings/tokens");
  await pageA.getByLabel("token label").fill("ci");
  await pageA.getByRole("button", { name: "Create token" }).click();
  const tokenA = await pageA.getByTestId("new-token").inputValue();

  const post = await pageA.request.post("/api/plans", {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { title: "Agent Plan", markdown: "The cloud setup needs review." },
  });
  expect(post.status()).toBe(201);
  const { id } = await post.json();

  // A's token reads its own feedback.
  const fbA = await pageA.request.get(`/api/plans/${id}/feedback`, { headers: { Authorization: `Bearer ${tokenA}` } });
  expect(fbA.status()).toBe(200);

  // B's token cannot read A's plan → 404 (no existence leak).
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto("/app/settings/tokens");
  await pageB.getByLabel("token label").fill("ci");
  await pageB.getByRole("button", { name: "Create token" }).click();
  const tokenB = await pageB.getByTestId("new-token").inputValue();

  const fbB = await pageB.request.get(`/api/plans/${id}/feedback`, { headers: { Authorization: `Bearer ${tokenB}` } });
  expect(fbB.status()).toBe(404);

  // Unauthenticated → 401.
  const unauth = await pageA.request.get(`/api/plans/${id}/feedback`);
  expect(unauth.status()).toBe(401);

  await ctxA.close();
  await ctxB.close();
});
