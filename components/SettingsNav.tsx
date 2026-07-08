"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/settings/tokens", label: "API tokens" },
    { href: "/settings/webhooks", label: "Webhooks" },
    ...(isAdmin ? [{ href: "/settings/admin", label: "Admin" }] : []),
  ];
  return (
    <nav className="mb-6 flex gap-2 text-sm" data-testid="settings-subnav">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-[var(--radius-app)] px-2.5 py-1.5 ${active ? "bg-primary-subtle text-primary" : "text-foreground hover:text-primary"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
