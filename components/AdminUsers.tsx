"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Row = { id: string; name: string; email: string; role: string | null; disabled: boolean };

const ERROR_MESSAGES: Record<string, string> = {
  cannot_modify_self: "You can't change your own account.",
  cannot_modify_env_admin: "This user is an environment-configured admin and can't be modified here.",
};

export function AdminUsers({ initial, selfId }: { initial: Row[]; selfId: string }) {
  const [users, setUsers] = useState(initial);
  const [error, setError] = useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError((data?.error && ERROR_MESSAGES[data.error]) ?? "Action failed");
      return null;
    }
    return res.json();
  }

  async function toggleRole(u: Row) {
    const role = u.role === "admin" ? "member" : "admin";
    if (await patch(u.id, { role })) setUsers((p) => p.map((x) => (x.id === u.id ? { ...x, role } : x)));
  }
  async function toggleDisabled(u: Row) {
    const disabled = !u.disabled;
    if (await patch(u.id, { disabled })) setUsers((p) => p.map((x) => (x.id === u.id ? { ...x, disabled } : x)));
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold text-foreground">Users</h2>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="admin-users">
          <thead>
            <tr className="text-left text-muted">
              <th className="p-2 font-medium">Email</th>
              <th className="p-2 font-medium">Role</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.email}`} className="border-t border-border">
                <td className="p-2 text-foreground">{u.email}</td>
                <td className="p-2 text-foreground">{u.role ?? "member"}</td>
                <td className="p-2 text-foreground">{u.disabled ? "deactivated" : "active"}</td>
                <td className="p-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={u.id === selfId} onClick={() => toggleRole(u)}>
                      {u.role === "admin" ? "Demote" : "Make admin"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={u.id === selfId} onClick={() => toggleDisabled(u)}>
                      {u.disabled ? "Reactivate" : "Deactivate"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
