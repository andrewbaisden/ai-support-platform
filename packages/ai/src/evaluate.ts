import type {
  TicketClassificationResult,
  TicketClassifier,
} from "./classifier";
import { AiError } from "./errors";
import { TRIAGE_FIXTURE_VERSION, triageFixtures } from "./fixtures";
import { evaluateGitHubEscalation, routeForType } from "./policy";

export interface EvaluationCaseResult {
  name: string;
  actual?: TicketClassificationResult;
  route?: ReturnType<typeof routeForType>;
  eligible?: boolean;
  passed: boolean;
  mismatches: string[];
}

export interface EvaluationSummary {
  fixtureVersion: string;
  total: number;
  passed: number;
  results: EvaluationCaseResult[];
}

/** Run a classifier over the labeled fixture set without touching a database. */
export async function runEvaluation(
  classifier: TicketClassifier,
): Promise<EvaluationSummary> {
  const results: EvaluationCaseResult[] = [];
  for (const fixture of triageFixtures) {
    let actual: TicketClassificationResult | undefined;
    try {
      actual = await classifier.classify({
        message: fixture.message,
        categoryHint: fixture.categoryHint,
      });
    } catch (error) {
      const code =
        error instanceof AiError ? error.code : "AI_INVALID_RESPONSE";
      results.push({
        name: fixture.name,
        passed: false,
        mismatches: [`classifier error ${code}`],
      });
      continue;
    }
    const route = routeForType(actual.type);
    const { eligible } = evaluateGitHubEscalation({
      type: actual.type,
      route,
      confidence: actual.confidence,
    });
    const mismatches: string[] = [];
    if (actual.type !== fixture.expectedType) {
      mismatches.push(`type ${actual.type} != ${fixture.expectedType}`);
    }
    if (route !== fixture.expectedRoute) {
      mismatches.push(`route ${route} != ${fixture.expectedRoute}`);
    }
    if (eligible !== fixture.expectedEligible) {
      mismatches.push(`eligible ${eligible} != ${fixture.expectedEligible}`);
    }
    results.push({
      name: fixture.name,
      actual,
      route,
      eligible,
      passed: mismatches.length === 0,
      mismatches,
    });
  }
  return {
    fixtureVersion: TRIAGE_FIXTURE_VERSION,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    results,
  };
}
