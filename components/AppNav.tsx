"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "./ThemeToggle";
import { useNotifications } from "@/components/NotificationProvider";

const LINKS = [
  { href: "/", match: "/", label: "Documents", testid: undefined as string | undefined },
  { href: "/inbox", match: "/inbox", label: "Inbox", testid: "inbox-link" },
  // Lands on API tokens (the page that onboards an agent); `match` keeps the
  // tab highlighted across every /settings/* sub-page.
  { href: "/settings/tokens", match: "/settings", label: "Settings", testid: "settings-link" },
];

export function AppNav({ email }: { email: string }) {
  const pathname = usePathname();
  const { unread } = useNotifications();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-mono font-semibold text-foreground">◆ Consensum</Link>
          <nav className="flex items-center gap-1 text-sm">
            {LINKS.map((l) => {
              const active = l.match === "/" ? pathname === "/" : pathname.startsWith(l.match);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  data-testid={l.testid}
                  className={`rounded-[var(--radius-app)] px-2.5 py-1.5 ${active ? "bg-primary-subtle text-primary" : "text-muted hover:text-foreground"}`}
                >
                  {l.label}
                  {l.href === "/inbox" && unread > 0 && (
                    <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs text-danger-fg">{unread}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span data-testid="current-user" className="max-w-[45vw] truncate text-muted sm:max-w-[220px] md:max-w-none">{email}</span>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
