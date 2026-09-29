import { z } from "zod";

const MAX_APP_NAME_LENGTH = 34;

/**
 * GitHub App manifest for a self-hosted IssueRelay: the minimum permissions
 * (Issues read/write, Metadata read-only) and, crucially, the Issues event
 * subscription, which is easy to miss when registering an App by hand.
 */
export function buildAppManifest(input: {
  platformUrl: string;
  redirectUrl: string;
  name?: string;
}) {
  const platform = new URL(input.platformUrl);
  if (platform.protocol !== "https:") {
    throw new Error("The platform URL must use https://");
  }
  const origin = platform.origin;
  // "issuerelay-selfhost" → "IssueRelay selfhost", not a doubled prefix.
  const label = (platform.hostname.split(".")[0] ?? "")
    .replace(/^issuerelay-?/i, "")
    .trim();
  const name = (input.name ?? (label ? `IssueRelay ${label}` : "IssueRelay"))
    .slice(0, MAX_APP_NAME_LENGTH)
    .trim();
  return {
    name,
    url: origin,
    description:
      "IssueRelay: turns confirmed support bug reports into GitHub issues and syncs their state back.",
    hook_attributes: { url: `${origin}/api/webhooks/github`, active: true },
    redirect_url: input.redirectUrl,
    public: false,
    default_permissions: { issues: "write", metadata: "read" },
    default_events: ["issues"],
  } as const;
}

const conversionSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  html_url: z.url(),
  pem: z.string().includes("PRIVATE KEY"),
  webhook_secret: z.string().min(16),
});

export type CreatedApp = z.infer<typeof conversionSchema>;

/** Exchange the one-time manifest code for the new App's credentials. */
export async function convertManifestCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedApp> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) {
    throw new Error("Invalid manifest code");
  }
  const response = await fetchImpl(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub rejected the manifest code (${response.status})`);
  }
  const parsed = conversionSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Unexpected GitHub App response");
  return parsed.data;
}

/** Git-ignored env file content with the App's server-only credentials. */
export function appEnvFile(app: CreatedApp): string {
  return [
    `# GitHub App "${app.slug}" (${app.html_url}). Server-only secrets:`,
    "# copy these into your hosting provider, then delete this file.",
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_PRIVATE_KEY="${app.pem.trim().replace(/\r?\n/g, "\\n")}"`,
    `GITHUB_WEBHOOK_SECRET=${app.webhook_secret}`,
    "",
  ].join("\n");
}
