import type { TicketRoute, TicketType } from "./classifier";

export interface LabeledTriageCase {
  name: string;
  message: string;
  categoryHint?: "question" | "bug" | "feature_request";
  expectedType: TicketType;
  expectedRoute: TicketRoute;
  expectedEligible: boolean;
}

/**
 * Versioned fixture dataset for triage evaluation. Labels encode the routing
 * policy, not model internals; version the set when labels change.
 */
export const TRIAGE_FIXTURE_VERSION = "triage-fixtures-v1";

export const triageFixtures: LabeledTriageCase[] = [
  {
    name: "question",
    message: "What technologies did you use to build this website?",
    categoryHint: "question",
    expectedType: "question",
    expectedRoute: "support",
    expectedEligible: false,
  },
  {
    name: "bug",
    message:
      "The projects section becomes blank in Safari after switching to dark mode.",
    categoryHint: "bug",
    expectedType: "bug",
    expectedRoute: "engineering",
    expectedEligible: true,
  },
  {
    name: "feature-request",
    message: "It would be great if the portfolio had a search bar.",
    categoryHint: "feature_request",
    expectedType: "feature_request",
    expectedRoute: "product",
    expectedEligible: false,
  },
  {
    name: "spam",
    message: "Buy cheap cryptocurrency now...",
    categoryHint: "question",
    expectedType: "spam",
    expectedRoute: "ignore",
    expectedEligible: false,
  },
  {
    name: "ambiguous",
    message: "The contact section is weird.",
    expectedType: "other",
    expectedRoute: "support",
    expectedEligible: false,
  },
  {
    name: "category-disagreement",
    message: "How did you build the animated background?",
    categoryHint: "bug",
    expectedType: "question",
    expectedRoute: "support",
    expectedEligible: false,
  },
  {
    name: "critical-bug",
    message:
      "Submitting the payment form exposes another customer's billing information.",
    categoryHint: "bug",
    expectedType: "bug",
    expectedRoute: "engineering",
    expectedEligible: true,
  },
];
