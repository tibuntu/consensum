"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signIn.email({ email, password });
    if (error) return setError(error.message ?? "Login failed");
    router.push("/app");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-24 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-semibold">Log in</h1>
      <input
        aria-label="email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2"
      />
      <input
        aria-label="password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border p-2"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" className="bg-black p-2 text-white">
        Log in
      </button>
      <a href="/register" className="text-sm underline">
        Need an account? Sign up
      </a>
    </form>
  );
}
