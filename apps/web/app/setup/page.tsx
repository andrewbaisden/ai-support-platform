import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  liveSetupDependencies,
  platformUrl,
  setupAvailable,
} from "../../lib/setup";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/** First-run setup: available only before the first account exists. */
export default async function SetupPage() {
  if (!(await setupAvailable(liveSetupDependencies()))) notFound();
  const host = (await headers()).get("host");
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        First-run setup
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Set up IssueRelay
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Create the owner account and your first project. You will get the widget
        key and code to add to your site.
      </p>
      <div className="mt-6 rounded border border-slate-200 bg-white p-6">
        <SetupForm apiBaseUrl={platformUrl(host)} />
      </div>
    </main>
  );
}
