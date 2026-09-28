/** Classification sources that can justify publishing on their own. */
const TRUSTED_SOURCES = new Set(["model", "manual"]);

export interface EscalationPolicy {
  /**
   * Let fixture/fallback classifications escalate without an owner
   * recommendation. Only for fully synthetic local runs with the mock
   * tracker; never set when a real GitHub App is used.
   */
  allowFixtureClassifications?: boolean;
}

/**
 * A deterministic fixture or fallback decision is not evidence that a
 * report is a real bug. Publishing it needs a model/manual classification
 * or an explicit owner recommendation. Returns the blocking reason, if any.
 */
export function provenanceBlock(input: {
  source: string;
  ownerRecommended: boolean;
  policy?: EscalationPolicy | undefined;
}): string | undefined {
  if (
    TRUSTED_SOURCES.has(input.source) ||
    input.ownerRecommended ||
    input.policy?.allowFixtureClassifications
  ) {
    return undefined;
  }
  return `classification source ${input.source} needs a model result or an owner recommendation`;
}
