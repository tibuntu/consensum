"use client";
import { useState } from "react";

export function NotificationSettings({ initial }: { initial: { email: boolean; desktop: boolean } }) {
  const [email, setEmail] = useState(initial.email);
  const [desktop, setDesktop] = useState(initial.desktop);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, boolean>, revert: () => void) {
    setSaving(true);
    await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(revert);
    setSaving(false);
  }

  async function toggleEmail() {
    const next = !email;
    setEmail(next);
    await save({ emailNotifications: next }, () => setEmail(!next));
  }

  async function toggleDesktop() {
    const next = !desktop;
    if (next && typeof Notification !== "undefined" && (await Notification.requestPermission()) !== "granted") {
      return; // permission denied → leave toggle off, persist nothing
    }
    setDesktop(next);
    await save({ desktopNotifications: next }, () => setDesktop(!next));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="email-pref" checked={email} disabled={saving} onChange={toggleEmail} />
        Email me about activity on my documents
      </label>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="desktop-pref" checked={desktop} disabled={saving} onChange={toggleDesktop} />
        Show desktop notifications when Quorum is in the background
      </label>
      <p className="text-sm text-muted">Emails are only sent when the server has SMTP configured.</p>
    </div>
  );
}
