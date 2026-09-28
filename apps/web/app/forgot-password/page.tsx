import { passwordResetAvailable } from "../../lib/email-config";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const available = passwordResetAvailable();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <div className="mt-6 rounded border border-slate-200 bg-white p-6">
        {available ? (
          <ForgotPasswordForm />
        ) : (
          <p role="status" className="text-sm text-slate-700">
            Password reset by email is not configured for this installation. Ask
            the workspace owner to reset your account.
          </p>
        )}
      </div>
      <p className="mt-4 text-sm">
        <a className="underline" href="/login">
          Back to sign in
        </a>
      </p>
    </main>
  );
}
