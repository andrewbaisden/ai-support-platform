"use client";

import { authClient } from "@ai-support-platform/auth/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { safeCallbackUrl } from "../../lib/callback-url";

export default function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = safeCallbackUrl(callbackUrl);

  return (
    <form
      aria-label="Operator sign in"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        void authClient.signIn.email(
          { email, password, callbackURL: target },
          {
            onSuccess: () => router.push(target),
            onError: (context) => {
              setError(context.error.message || "Sign in failed.");
              setPending(false);
            },
          },
        );
      }}
      className="grid gap-4"
    >
      <label className="text-sm">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Password
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
