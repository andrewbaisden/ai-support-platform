export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Support platform
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">IssueRelay</h1>
      <p className="mt-4 max-w-xl text-lg text-slate-600">
        Turn website feedback into reviewed support tickets, and confirmed bugs
        into GitHub issues that stay in sync.
      </p>
      <p className="mt-6">
        <a
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href="/dashboard"
        >
          Open the dashboard
        </a>
      </p>
    </main>
  );
}
