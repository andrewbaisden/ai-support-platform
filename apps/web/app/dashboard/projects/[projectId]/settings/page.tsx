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
          Reports are accepted only from these exact origins (scheme, host, and
          port).
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
