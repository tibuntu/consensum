"use client";
import { useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  emitThemeChange,
  getChoice,
  STORAGE_KEY,
  subscribeTheme,
  THEME_OPTIONS,
  type ThemeChoice,
} from "@/lib/theme";

const LABEL: Record<ThemeChoice, string> = { light: "☀", dark: "☾", system: "⌖" };

export function ThemeToggle() {
  // useSyncExternalStore renders the server snapshot ("system") during hydration,
  // then the client value — no setState-in-effect and no hydration mismatch.
  const choice = useSyncExternalStore<ThemeChoice>(subscribeTheme, getChoice, () => "system");

  // While in system, keep the class in sync with live OS preference changes.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  function pick(next: ThemeChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    emitThemeChange();
  }

  function cycle() {
    const i = THEME_OPTIONS.indexOf(choice);
    pick(THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length]);
  }

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-choice={choice}
      onClick={cycle}
      title={`Theme: ${choice} (click to change)`}
      aria-label={`Theme: ${choice} (click to change)`}
      className="rounded px-2 py-1 text-sm text-muted hover:text-foreground"
    >
      {LABEL[choice]}
    </button>
  );
}
