import { z } from "zod";

const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const shortText = z.string().trim().min(1).max(200);

/** Minimal issues-event subset; everything else is ignored, not trusted. */
export const issuesWebhookSchema = z.object({
  // Unknown actions are acknowledged as ignored, not rejected: GitHub sends
  // many actions (labeled, assigned, ...) this system deliberately skips.
  action: z.string().trim().min(1).max(80),
  issue: z.object({
    id: githubId,
    number: z.number().int().positive(),
    state: z.enum(["open", "closed"]),
    html_url: z.string().url().max(500).optional(),
    // Remote ordering hint; malformed values are dropped, not trusted.
    updated_at: z.iso.datetime().optional().catch(undefined),
  }),
  repository: z.object({
    id: githubId,
    name: shortText,
    owner: z.object({ login: shortText }),
  }),
  installation: z.object({ id: githubId }).optional(),
});

export type IssuesWebhook = z.infer<typeof issuesWebhookSchema>;
