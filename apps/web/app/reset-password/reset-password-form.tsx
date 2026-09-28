"use client";

import { authClient } from "@ai-support-platform/auth/client";
import { useState } from "react";

const MIN_PASSWORD_LENGTH = 12;

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p role="status" className="text-sm text-slate-700">
        Password updated and other sessions signed out.{" "}
        <a className="underline" href="/login">
          Sign in
        </a>
      </p>
    );
  }
  return (
    <form
      aria-label="Choose a new password"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
          return;
        }
        if (password !== confirm) {
          setError("The passwords do not match.");
          return;
        }
        setPending(true);
        setError(null);
        void authClient.resetPassword(
          { newPassword: password, token },
          {
            onSuccess: () => setDone(true),
            onError: () => {
              setError(
                "This reset link is invalid or has expired. Request a new one.",
              );
              setPending(false);
            },
          },
        );
      }}
    >
      <label className="text-sm">
        New password
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Confirm new password
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
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
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
