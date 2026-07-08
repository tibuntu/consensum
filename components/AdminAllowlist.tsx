"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Entry = { id: string; value: string };

export function AdminAllowlist({ env, initial }: { env: string[]; initial: Entry[] }) {
  const [entries, setEntries] = useState(initial);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (res.status !== 201) {
      setError("Enter a valid email, domain, or *");
      return;
    }
    const { id } = await res.json();
    // addAllowlistEntry upserts on the unique value, so re-adding an existing
    // entry returns its current id — don't prepend a duplicate <li>/React key.
    setEntries((p) => (p.some((x) => x.id === id) ? p : [{ id, value: value.trim().toLowerCase().replace(/^@/, "") }, ...p]));
    setValue("");
  }
  async function remove(id: string) {
    await fetch(`/api/admin/allowlist/${id}`, { method: "DELETE" });
    setEntries((p) => p.filter((x) => x.id !== id));
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold text-foreground">Registration allowlist</h2>
      <p className="text-sm text-muted">
        Emails or domains permitted to register. Environment entries are configured by the operator and cannot be
        edited here.
      </p>
      <ul className="flex flex-col gap-1 text-sm" data-testid="allowlist-env">
        {env.map((v) => (
          <li key={`env-${v}`} className="flex justify-between text-muted">
            <span>{v}</span>
            <span className="text-xs">via environment</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-1 text-sm" data-testid="allowlist-db">
        {entries.map((e) => (
          <li key={e.id} data-testid={`allowlist-row-${e.value}`} className="flex items-center justify-between">
            <span className="text-foreground">{e.value}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(e.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input
          aria-label="allowlist entry"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="user@corp.com, corp.com, or *"
        />
        <Button type="submit">Add</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
