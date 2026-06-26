"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/settings/notifications", label: "Notifications" },
  { href: "/app/settings/tokens", label: "API tokens" },
  { href: "/app/settings/webhooks", label: "Webhooks" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <nav className="mb-6 flex gap-2 text-sm" data-testid="settings-subnav">
        {TABS.map((t) => {
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
      {children}
    </div>
  );
}
