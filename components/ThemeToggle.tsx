"use client";
import { useEffect, useSyncExternalStore } from "react";
import { resolveDark, STORAGE_KEY, type ThemeChoice } from "@/lib/theme";

const OPTIONS: ThemeChoice[] = ["light", "dark", "system"];
const LABEL: Record<ThemeChoice, string> = { light: "☀", dark: "☾", system: "⌖" };

// External store over the persisted choice. useSyncExternalStore renders the
// server snapshot ("system") during hydration, then the client value — no
// setState-in-effect and no hydration mismatch.
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
  return stored && OPTIONS.includes(stored) ? stored : "system";
}

function apply(choice: ThemeChoice) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", resolveDark(choice, prefersDark));
}

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, getChoice, () => "system");

  // While in system, keep the class in sync with live OS preference changes.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: ThemeChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    apply(next);
    emit();
  }

  return (
    <div className="flex items-center gap-1" data-testid="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          data-testid={`theme-${o}`}
          aria-pressed={choice === o}
          onClick={() => pick(o)}
          title={o}
          className={`rounded px-2 py-1 text-sm ${choice === o ? "bg-primary-subtle text-foreground" : "text-muted hover:text-foreground"}`}
        >
          {LABEL[o]}
        </button>
      ))}
    </div>
  );
}
