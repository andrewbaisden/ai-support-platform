import { getAuth } from "@ai-support-platform/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.callbackUrl)
    ? params.callbackUrl[0]
    : params.callbackUrl;
  const callbackUrl =
    raw?.startsWith("/") === true && !raw.startsWith("//") ? raw : "/dashboard";
  try {
    const session = await getAuth().api.getSession({
      headers: await headers(),
    });
    if (session?.user) redirect(callbackUrl);
  } catch {
    // No usable session: fall through to the sign-in form.
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Operator access
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Sign in to the dashboard
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Owner accounts are created by the controlled seed flow. Public
        self-signup is disabled.
      </p>
      <div className="mt-6 rounded border border-slate-200 bg-white p-6">
        <LoginForm callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
