import {
  createMockTrackerFactory,
  createTrackerFactory,
  GithubError,
  type TrackerFactory,
} from "@ai-support-platform/github";

/**
 * True only for the explicit, non-production mock hook. Fully synthetic
 * mock runs may escalate fixture classifications; real App runs may not.
 */
export function usesMockEscalation(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.GITHUB_ESCALATION_MOCK === "1"
  );
}

/**
 * Tracker selection for dashboard escalation. The mock is an explicit,
 * documented test hook (GITHUB_ESCALATION_MOCK=1); production paths always
 * use the GitHub App factory, which holds installation tokens in memory only.
 */
export function createEscalationTrackers(): TrackerFactory {
  if (usesMockEscalation()) {
    return createMockTrackerFactory();
  }
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) {
    throw new GithubError(
      "GITHUB_MISCONFIGURED",
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required",
    );
  }
  return createTrackerFactory({
    appId,
    privateKey: rawKey.replace(/\\n/g, "\n"),
  });
}
