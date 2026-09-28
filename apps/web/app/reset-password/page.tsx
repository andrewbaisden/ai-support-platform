import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <div className="mt-6 rounded border border-slate-200 bg-white p-6">
        {token && !params.error ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p role="alert" className="text-sm text-slate-700">
            This reset link is invalid or has expired.{" "}
            <a className="underline" href="/forgot-password">
              Request a new one
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
