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
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signUp.email({ email, password, name });
    if (error) return setError(error.message ?? "Sign up failed");
    router.push("/app");
  }

  return (
    <Card className="mx-auto mt-24 max-w-sm p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-primary">◆ Quorum</span>
        <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
        <Input
          aria-label="name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          aria-label="password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-[var(--state-changes)]">
            {error}
          </p>
        )}
        <Button type="submit">Sign up</Button>
        <Link href="/login" className="text-sm text-muted hover:text-foreground">
          Already have an account? Log in
        </Link>
      </form>
    </Card>
  );
}
