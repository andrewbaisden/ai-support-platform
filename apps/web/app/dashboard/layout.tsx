import type { ReactNode } from "react";
import { requireDashboardUser } from "../../lib/dashboard-session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, workspaces } = await requireDashboardUser();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Operator dashboard
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              <a href="/dashboard">Support tickets</a>
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            Signed in as {user.email}
            {workspaces.length > 0 && (
              <span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs">
                {workspaces[0]?.role}
              </span>
            )}
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
