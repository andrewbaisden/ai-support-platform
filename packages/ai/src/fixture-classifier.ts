import type {
  Severity,
  TicketClassificationInput,
  TicketClassificationResult,
  TicketClassifier,
  TicketType,
} from "./classifier";

interface MockRule {
  type: TicketType;
  severity: Severity;
  confidence: number;
  pattern: RegExp;
}

/**
 * Deterministic test double. Keyword rules stand in for model judgment so CI
 * and development never need Jev credentials. The hint is deliberately
 * ignored: the mock proves categoryHint is not ground truth. Not product
 * logic; do not tune application behavior against these patterns.
 */
const RULES: MockRule[] = [
  {
    type: "spam",
    severity: "low",
    confidence: 0.99,
    pattern:
      /cheap crypto|buy now|seo services|casino|weight-loss|miracle loan/i,
  },
  {
    type: "bug",
    severity: "critical",
    confidence: 0.96,
    pattern: /expos|leak|breach|another customer|sees? my|someone else's/i,
  },
  {
    type: "bug",
    severity: "high",
    confidence: 0.94,
    pattern:
      /blank|crash|broken|doesn'?t work|fails?|error|down|can'?t|unable to/i,
  },
  {
    type: "feature_request",
    severity: "low",
    confidence: 0.91,
    pattern:
      /would be great|wish|search bar|add (a|an|support)|feature|improve/i,
  },
  {
    type: "billing",
    severity: "medium",
    confidence: 0.9,
    pattern: /charged twice|invoice|refund|subscription|payment failed/i,
  },
  {
    type: "account",
    severity: "medium",
    confidence: 0.89,
    pattern: /log ?in|password|account locked|profile/i,
  },
  {
    type: "question",
    severity: "low",
    confidence: 0.97,
    pattern: /\?|^(what|how|why|when|where|which|can you|do you)\b/i,
  },
];

export class FixtureTicketClassifier implements TicketClassifier {
  async classify(
    input: TicketClassificationInput,
  ): Promise<TicketClassificationResult> {
    for (const rule of RULES) {
      if (rule.pattern.test(input.message)) {
        return {
          type: rule.type,
          severity: rule.severity,
          confidence: rule.confidence,
          reason: `Fixture rule matched ${rule.type} with confidence ${rule.confidence}.`,
          provider: "fixture",
          model: "fixture-v1",
        };
      }
    }
    return {
      type: "other",
      severity: "low",
      confidence: 0.62,
      reason: "Fixture fallback: no rule matched, needs owner review.",
      provider: "fixture",
      model: "fixture-v1",
    };
  }
}
