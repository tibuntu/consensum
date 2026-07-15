"use client";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(searchParams.get("error") === "sso" ? "SSO sign-in failed. Please try again or use your password." : "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { error } = await signIn.email({ email, password });
      if (error) { setError(error.message ?? "Login failed"); return; }
      router.push("/");
    } finally {
      setSubmitting(false);
    }
  }

  const oidcEnabled = process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";

  async function onSso() {
    setError("");
    try {
      await signIn.oauth2({
        providerId: "oidc",
        callbackURL: "/",
        errorCallbackURL: "/login?error=sso",
      });
    } catch {
      setError("SSO sign-in is unavailable right now. Please try again.");
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <span className="font-mono text-sm font-semibold text-primary">◆ Consensum</span>
          <h1 className="text-xl font-semibold text-foreground">Log in</h1>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Email
            <Input
              type="email"
              autoComplete="username"
              autoFocus
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
              autoComplete="current-password"
              required
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--state-changes)]">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>{submitting ? "Logging in…" : "Log in"}</Button>
          {oidcEnabled && (
            <Button type="button" variant="secondary" onClick={onSso}>
              Sign in with SSO
            </Button>
          )}
          <Link href="/register" className="text-sm text-muted hover:underline">
            Need an account? <span className="font-medium text-primary">Sign up</span>
          </Link>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
