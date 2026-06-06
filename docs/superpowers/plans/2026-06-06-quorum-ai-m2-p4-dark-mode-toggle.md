# M2/P4 — Dark-Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted, user-selectable light/dark/system theme with no flash-of-wrong-theme, replacing the current OS-only `prefers-color-scheme` behavior.

**Architecture:** Class-based theming — dark tokens move from the media query to a `:root.dark` selector; a tiny pure module (`lib/theme.ts`) holds the choice type, the `resolveDark` function, and the inline no-flash script source; the root layout injects that script in `<head>`; a header `ThemeToggle` writes the choice to `localStorage` and applies the class live (tracking the OS while in `system`).

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (CSS-variable tokens), Vitest, Playwright. No DB changes.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m2-p4-dark-mode-toggle-design.md`

**Execution notes:** `CI=true` prefix on scripts; rebase onto `main` (no merges); no `Co-Authored-By` trailer.

---

### Task 1: Theme core (`lib/theme.ts`) — resolver + script source

**Goal:** Pure, testable theme primitives: the choice type, `resolveDark`, storage key, and the exact inline-script string used both at boot and by the toggle.

**Files:**
- Create: `lib/theme.ts`
- Test: `tests/unit/theme.test.ts`

**Acceptance Criteria:**
- [ ] `resolveDark("dark", false)` → true; `resolveDark("light", true)` → false.
- [ ] `resolveDark("system", true)` → true; `resolveDark("system", false)` → false.
- [ ] `THEME_SCRIPT` is a non-empty string referencing the storage key and `classList`.

**Verify:** `CI=true pnpm test:unit tests/unit/theme.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

`tests/unit/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveDark, THEME_SCRIPT, STORAGE_KEY } from "../../lib/theme";

it("resolveDark explicit choices", () => {
  expect(resolveDark("dark", false)).toBe(true);
  expect(resolveDark("light", true)).toBe(false);
});

it("resolveDark system follows OS", () => {
  expect(resolveDark("system", true)).toBe(true);
  expect(resolveDark("system", false)).toBe(false);
});

it("THEME_SCRIPT references storage + classList", () => {
  expect(THEME_SCRIPT).toContain(STORAGE_KEY);
  expect(THEME_SCRIPT).toContain("classList");
});
```

- [ ] **Step 2: Run to verify it fails** — module missing → FAIL.

- [ ] **Step 3: Implement `lib/theme.ts`**

```ts
export type ThemeChoice = "light" | "dark" | "system";
export const STORAGE_KEY = "quorum-theme";

/** Pure: given a choice and the OS dark preference, should `.dark` be applied? */
export function resolveDark(choice: ThemeChoice, prefersDark: boolean): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return prefersDark;
}

/** Inline boot script (runs before paint) — single source of truth for class application. */
export const THEME_SCRIPT = `(function(){try{
var c=localStorage.getItem('${STORAGE_KEY}')||'system';
var d=c==='dark'||(c==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', d);
}catch(e){}})();`;
```

- [ ] **Step 4: Run to verify it passes** — `... → PASS`.

- [ ] **Step 5: Commit**

```bash
git add lib/theme.ts tests/unit/theme.test.ts
git commit -m "feat(theme): pure resolveDark + no-flash boot script source"
```

---

### Task 2: Class-based dark tokens (`app/globals.css`)

**Goal:** Drive dark tokens off a `:root.dark` class instead of the `prefers-color-scheme` media query, so JS controls the theme (and `system` is resolved in JS).

**Files:**
- Modify: `app/globals.css`

**Acceptance Criteria:**
- [ ] The dark token block applies under `:root.dark` (or `html.dark`), not `@media (prefers-color-scheme: dark)`.
- [ ] Light tokens remain the default on `:root`.
- [ ] `@theme inline` mapping is unchanged; the app still builds.

**Verify:** `CI=true pnpm build` → succeeds; visually, adding `class="dark"` to `<html>` flips the palette.

**Steps:**

- [ ] **Step 1: Replace the media query with a class selector**

In `app/globals.css`, change the dark block header from:

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* dark tokens... */
  }
}
```

to:

```css
:root.dark {
  /* dark tokens... (identical values, unchanged) */
}
```

Keep every dark token value exactly as-is; only the selector changes. Leave the light `:root` block and the `@theme inline` block untouched.

- [ ] **Step 2: Verify build** — `CI=true pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): class-based .dark tokens (JS-resolved, drop media query)"
```

---

### Task 3: No-flash script injection (`app/layout.tsx`)

**Goal:** Apply the resolved theme class before first paint to prevent FOUC.

**Files:**
- Modify: `app/layout.tsx`

**Acceptance Criteria:**
- [ ] `THEME_SCRIPT` is injected in `<head>` and runs before body render.
- [ ] `<html>` retains `suppressHydrationWarning`.
- [ ] App builds and renders with no console hydration errors.

**Verify:** `CI=true pnpm build` → succeeds; manual: with dark persisted, a fresh load shows dark immediately (no light flash).

**Steps:**

- [ ] **Step 1: Inject the script**

In `app/layout.tsx`, add a `<head>` containing the boot script (RootLayout currently has none):

```tsx
import { THEME_SCRIPT } from "@/lib/theme";

// inside <html ... suppressHydrationWarning>:
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
```

(Keep existing `<html>` className/lang/`suppressHydrationWarning` exactly.)

- [ ] **Step 2: Verify build** — `CI=true pnpm build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(theme): inject no-flash boot script in root layout"
```

---

### Task 4: ThemeToggle control + e2e

**Goal:** A 3-way header control that persists the choice, applies it live, and tracks the OS while in `system`.

**Files:**
- Create: `components/ThemeToggle.tsx`
- Modify: `components/AppNav.tsx` (place the toggle)
- Test: `tests/e2e/theme.spec.ts`

**Acceptance Criteria:**
- [ ] Control exposes light / dark / system; selecting one updates `localStorage` and `<html>.dark` immediately.
- [ ] Choice persists across reload.
- [ ] In `system`, the theme tracks `prefers-color-scheme` changes live.
- [ ] Toggle sits in the header's right-hand cluster.

**Verify:** `CI=true pnpm test:e2e tests/e2e/theme.spec.ts` → PASS

**Steps:**

- [ ] **Step 1: Implement `components/ThemeToggle.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { resolveDark, STORAGE_KEY, type ThemeChoice } from "@/lib/theme";

const OPTIONS: ThemeChoice[] = ["light", "dark", "system"];
const LABEL: Record<ThemeChoice, string> = { light: "☀", dark: "☾", system: "⌖" };

function apply(choice: ThemeChoice) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", resolveDark(choice, prefersDark));
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeChoice) || "system";
    setChoice(OPTIONS.includes(stored) ? stored : "system");
  }, []);

  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: ThemeChoice) {
    setChoice(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    apply(next);
  }

  return (
    <div className="flex items-center gap-1" data-testid="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button key={o} type="button" data-testid={`theme-${o}`} aria-pressed={choice === o}
          onClick={() => pick(o)} title={o}
          className={`rounded px-2 py-1 text-sm ${choice === o ? "bg-primary-subtle text-foreground" : "text-muted hover:text-foreground"}`}>
          {LABEL[o]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Place it in the header**

In `components/AppNav.tsx`, inside the right-hand `<div className="flex items-center gap-4 ...">`, add before `<SignOutButton />`:

```tsx
<ThemeToggle />
```

Add the import: `import { ThemeToggle } from "./ThemeToggle";`

- [ ] **Step 3: E2e test**

`tests/e2e/theme.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
// reuse the register/login helper from existing specs to reach an authed page with AppNav

test("theme toggle persists and applies", async ({ page }) => {
  // login → land on /app
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/); // persisted, no flash
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("system mode follows emulated OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // login → land on /app
  await page.getByTestId("theme-system").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
```

- [ ] **Step 4: Run + commit**

```bash
CI=true pnpm test:e2e tests/e2e/theme.spec.ts
git add components/ThemeToggle.tsx components/AppNav.tsx tests/e2e/theme.spec.ts
git commit -m "feat(theme): 3-way light/dark/system toggle in header"
```

---

## Final verification

- [ ] `CI=true pnpm lint` → clean
- [ ] `CI=true pnpm test:unit tests/unit/theme.test.ts` → PASS
- [ ] `CI=true pnpm test:e2e tests/e2e/theme.spec.ts` → PASS
- [ ] Manual: persist dark, hard-reload — no flash of light; toggle to system on a dark OS shows dark, switch OS to light and it follows; confirm earlier dark-mode prose/contrast (remediated in M1) still reads correctly under the class-based switch.
