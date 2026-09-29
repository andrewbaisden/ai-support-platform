import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProjectSettings } from "../../../../../lib/dashboard";
import { requireDashboardUser } from "../../../../../lib/dashboard-session";
import { usesMockEscalation } from "../../../../../lib/github-tracker";
import { platformUrl } from "../../../../../lib/setup";
import { CopyField } from "../../../../components/copy-field";
import { InstallSnippet } from "../../../../components/install-snippet";
import { ConnectRepositoryForm, OriginsEditor } from "./settings-forms";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { projectId } = await params;
  const { user } = await requireDashboardUser();
  const settings = await getProjectSettings(user.id, projectId);
  if (!settings) notFound();
  const { project, access, repository } = settings;
  const isOwner = access.role === "owner";
  const apiBaseUrl = platformUrl((await headers()).get("host"));
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-slate-500">
        <a className="underline" href="/dashboard">
          Projects
        </a>{" "}
        /{" "}
        <a
          className="underline"
          href={`/dashboard/projects/${project.id}/tickets`}
        >
          {project.name}
        </a>{" "}
        / Settings
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
        Project settings
      </h2>

      <section
        aria-labelledby="install-heading"
        className="mt-6 grid gap-4 rounded border border-slate-200 bg-white p-5"
      >
        <h3 id="install-heading" className="font-semibold">
          Install the widget
        </h3>
        <p className="text-sm text-slate-600">
          The widget key identifies this project; it is public and safe to put
          in your site&apos;s code. Run{" "}
          <code>npm install @issuerelay/widget</code>, then add:
        </p>
        <CopyField label="Widget key" value={project.publicKey} />
        <InstallSnippet
          apiBaseUrl={apiBaseUrl}
          projectKey={project.publicKey}
        />
      </section>

      <section
        aria-labelledby="origins-heading"
        className="mt-6 grid gap-3 rounded border border-slate-200 bg-white p-5"
      >
        <h3 id="origins-heading" className="font-semibold">
          Allowed site addresses
        </h3>
        <p className="text-sm text-slate-600">
          The widget only sends reports from these exact addresses (scheme,
          host, and port); from anywhere else it shows &ldquo;We couldn&rsquo;t
          send your message.&rdquo; Use <code>http://localhost:3000</code> for a
          Next.js app on your computer, and add your live address, such as{" "}
          <code>https://my-site.vercel.app</code> or your own domain (with and
          without <code>www</code> if you use both).
        </p>
        {isOwner ? (
          <OriginsEditor
            projectId={project.id}
            initial={project.allowedOrigins}
          />
        ) : (
          <>
            <ul className="list-disc pl-5 text-sm" aria-label="Allowed origins">
              {project.allowedOrigins.map((origin) => (
                <li key={origin}>
                  <code>{origin}</code>
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-500">
              Only workspace owners can change these.
            </p>
          </>
        )}
      </section>

      <section
        aria-labelledby="github-heading"
        className="mt-6 grid gap-3 rounded border border-slate-200 bg-white p-5"
      >
        <h3 id="github-heading" className="font-semibold">
          GitHub repository
        </h3>
        {!settings.aiTriageConfigured && (
          <p
            className="rounded bg-amber-50 p-3 text-sm text-amber-900"
            role="status"
          >
            AI triage is not set up, so reports cannot become GitHub issues yet:
            they stay in the dashboard for review. Add a{" "}
            <code>TYPESAFE_API_KEY</code> to this deployment&apos;s environment
            variables and redeploy (see the self-hosting guide).
          </p>
        )}
        {repository ? (
          <p className="text-sm" role="status">
            Connected to{" "}
            <a
              className="font-medium text-blue-700 underline"
              href={`https://github.com/${repository.fullName}`}
              target="_blank"
              rel="noreferrer"
            >
              {repository.fullName}
            </a>
            {repository.status === "active" ? "" : ` (${repository.status})`}
          </p>
        ) : !settings.githubConfigured && !usesMockEscalation() ? (
          <p className="text-sm text-slate-600" role="status">
            GitHub is not configured on this deployment yet. Create the GitHub
            App (see the self-hosting guide), add its three environment
            variables, and redeploy.
          </p>
        ) : isOwner ? (
          <ConnectRepositoryForm projectId={project.id} />
        ) : (
          <p className="text-sm text-slate-600" role="status">
            No repository connected. A workspace owner can connect one.
          </p>
        )}
      </section>
    </div>
  );
}
