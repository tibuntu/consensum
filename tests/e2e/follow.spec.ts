import { test, expect, type Page, type BrowserContext } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function countEventSources(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __esCount: number; EventSource: typeof EventSource };
    w.__esCount = 0;
    const Native = w.EventSource;
    class Counting extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__esCount += 1;
      }
    }
    w.EventSource = Counting as unknown as typeof EventSource;
  });
}

const TALL_MARKDOWN =
  "# Follow me\n\n" +
  Array.from(
    { length: 80 },
    (_, i) => `Paragraph ${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join("\n\n");

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("follower tracks the leader, detaches on manual scroll, and resumes", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/");
  await pageA.getByLabel("title").fill("Follow demo");
  await pageA.getByLabel("markdown").fill(TALL_MARKDOWN);
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // A leads, B joins -> B auto-follows.
  await pageA.getByTestId("start-session").click();
  await expect(pageB.getByTestId("join-session")).toBeVisible();
  await pageB.getByTestId("join-session").click();
  await expect(pageB.getByTestId("following-indicator")).toBeVisible();

  // A scrolls down -> B tracks.
  await pageA.evaluate(() => window.scrollTo({ top: 1200 }));
  await expect.poll(() => scrollY(pageB), { timeout: 10_000 }).toBeGreaterThan(300);

  // Wait for B's programmatic (smooth) auto-scroll to fully settle before
  // simulating a manual scroll. The app guards against false detaches by
  // ignoring scroll events while a programmatic scroll is in flight, clearing
  // the guard on `scrollend` (with a 1s fallback). The poll above can resolve
  // mid-animation, so scrolling immediately would be swallowed as programmatic
  // and the follower would never detach. Wait until B's position is stable.
  await pageB.waitForFunction(
    () => {
      const w = window as unknown as { __prevY?: number };
      const settled = w.__prevY === window.scrollY;
      w.__prevY = window.scrollY;
      return settled;
    },
    undefined,
    { timeout: 5_000, polling: 250 },
  );

  // B scrolls manually -> detaches; A scrolling no longer moves B.
  await pageB.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(pageB.getByTestId("resume-following")).toBeVisible();
  await pageA.evaluate(() => window.scrollTo({ top: 2400 }));
  await pageB.waitForTimeout(1500);
  expect(await scrollY(pageB)).toBeLessThan(300);

  // B resumes -> tracks A again.
  await pageB.getByTestId("resume-following").click();
  await expect.poll(() => scrollY(pageB), { timeout: 10_000 }).toBeGreaterThan(300);
  await expect(pageB.getByTestId("following-indicator")).toBeVisible();

  // Exactly two EventSources in A's tab.
  expect(await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount)).toBe(2);

  // A ends the session -> B's follow UI clears.
  await pageA.getByTestId("end-session").click();
  await expect(pageB.getByTestId("following-indicator")).toHaveCount(0);
  await expect(pageB.getByTestId("resume-following")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
