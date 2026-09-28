/**
 * Retention policy (ADR-025). Contact details are erased this many days
 * after a ticket is resolved; terminal webhook delivery rows are deleted
 * after `webhookDays`, never sooner than `minimumWebhookDays` because GitHub
 * can redeliver deliveries from the past three days.
 */
export const RETENTION_DEFAULTS = {
  contactDays: 180,
  webhookDays: 90,
  minimumWebhookDays: 7,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoffs(now: Date = new Date()) {
  return {
    resolvedBefore: new Date(
      now.getTime() - RETENTION_DEFAULTS.contactDays * DAY_MS,
    ),
    receivedBefore: new Date(
      now.getTime() - RETENTION_DEFAULTS.webhookDays * DAY_MS,
    ),
  };
}
