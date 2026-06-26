"use client";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { relativeTime } from "@/lib/time";
import { notificationLabel } from "@/lib/notification-format";
import { useNotifications } from "@/components/NotificationProvider";

export default function InboxList() {
  const { items, markRead, markAllRead } = useNotifications();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Inbox</h1>
        {items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markAllRead()}>
            Mark all read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-muted">You&apos;re all caught up. New comments and decisions on your documents will appear here.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id} data-testid="notification">
              <Card className={`transition-colors hover:bg-primary-subtle ${n.read ? "" : "border-l-4 border-l-primary"}`}>
                <Link
                  href={`/app/documents/${n.documentId}`}
                  onClick={() => markRead(n.id)}
                  className={`flex items-center justify-between gap-4 p-3 ${n.read ? "text-muted" : "font-medium text-foreground"}`}
                >
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2">
                      {!n.read && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      {notificationLabel(n.type, n.actorName)}
                    </span>
                    <span className="text-xs text-muted">{n.documentTitle}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(n.createdAt)}</span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
