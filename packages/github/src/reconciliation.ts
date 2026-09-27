import { z } from "zod";
import type { CreatedIssue } from "./types";

const issueCandidateSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  number: z.number().int().positive(),
  html_url: z.url(),
  body: z.string().nullable(),
  user: z.object({ login: z.string(), type: z.string() }),
  pull_request: z.unknown().optional(),
});

/** Only an issue authored by this App's bot with a standalone exact marker is reconcilable. */
export function trustedReconciliationIssue(
  value: unknown,
  marker: string,
  appSlug: string,
): CreatedIssue | undefined {
  const parsed = issueCandidateSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const issue = parsed.data;
  if (
    issue.pull_request != null ||
    issue.user.type !== "Bot" ||
    issue.user.login.toLowerCase() !== `${appSlug.toLowerCase()}[bot]` ||
    !issue.body?.split(/\r?\n/).some((line) => line.trim() === marker)
  ) {
    return undefined;
  }
  const url = new URL(issue.html_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com")
    return undefined;
  return { id: issue.id, number: issue.number, url: issue.html_url };
}
