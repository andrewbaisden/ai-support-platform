/**
 * Triage policy configuration. Thresholds are uncalibrated hypotheses, not
 * measured accuracy claims; adjust only with labeled evaluation evidence.
 */

/** Minimum normalized confidence for automatic GitHub escalation eligibility. */
export const GITHUB_ESCALATION_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Jev-confidence floor below which a result is treated as genuinely uncertain.
 * Low-confidence tickets are still routed (the owner reviews history in the
 * dashboard), but never automatically eligible for GitHub escalation.
 */
export const LOW_CONFIDENCE_REVIEW_FLOOR = 0.5;

/** Per-attempt Jev request timeout in milliseconds. */
export const JEV_REQUEST_TIMEOUT_MS = 10_000;

/** Version tag for the Jev question wording, used for evaluation comparison. */
export const TRIAGE_QUESTION_SET_VERSION = "triage-v1";
