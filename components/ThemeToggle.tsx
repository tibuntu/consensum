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

const ICON: Record<ThemeChoice, React.ReactNode> = {
  light: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

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
      className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-app)] text-muted hover:bg-primary-subtle hover:text-foreground"
    >
      <span aria-hidden>{ICON[choice]}</span>
    </button>
  );
}
