"use client";

import { authClient } from "@ai-support-platform/auth/client";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p role="status" className="text-sm text-slate-700">
        If an account exists for that email, a reset link is on its way. It
        expires in one hour.
      </p>
    );
  }
  return (
    <form
      aria-label="Request a password reset"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        // The same confirmation shows whether or not the account exists.
        void authClient
          .requestPasswordReset({ email, redirectTo: "/reset-password" })
          .finally(() => {
            setPending(false);
            setSent(true);
          });
      }}
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
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
