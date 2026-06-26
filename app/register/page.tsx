"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const oidcEnabled = process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { error } = await signUp.email({ email, password, name });
      if (error) { setError(error.message ?? "Sign up failed"); return; }
      router.push("/app");
    } finally {
      setSubmitting(false);
    }
  }

  if (oidcEnabled) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-sm p-6">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-sm font-semibold text-primary">◆ Consensum</span>
            <h1 className="text-xl font-semibold text-foreground">Sign-up is via SSO</h1>
            <p className="text-sm text-muted">
              This workspace uses single sign-on. Create your account by signing in
              with your identity provider.
            </p>
            <Link href="/login" className="text-sm text-muted hover:underline">
              Go to <span className="font-medium text-primary">Log in</span>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <span className="font-mono text-sm font-semibold text-primary">◆ Consensum</span>
          <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Name
            <Input
              autoComplete="name"
              autoFocus
              required
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Email
            <Input
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Password
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--state-changes)]">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>{submitting ? "Signing up…" : "Sign up"}</Button>
          <Link href="/login" className="text-sm text-muted hover:underline">
            Already have an account? <span className="font-medium text-primary">Log in</span>
          </Link>
        </form>
      </Card>
    </div>
  );
}
