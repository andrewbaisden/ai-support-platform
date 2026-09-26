export const supportCategories = [
  "question",
  "bug",
  "feature_request",
] as const;

export type SupportCategory = (typeof supportCategories)[number];
export type WidgetPosition = "bottom-right" | "bottom-left";
export type WidgetTheme = "light" | "dark" | "system";

export interface SupportSubmissionInput {
  projectKey: string;
  category: SupportCategory;
  message: string;
  name?: string;
  email?: string;
  idempotencyKey: string;
}

export interface SupportSubmissionResult {
  reference: string;
}

export interface SupportSubmissionClient {
  submit(input: SupportSubmissionInput): Promise<SupportSubmissionResult>;
}

export interface SupportWidgetProps {
  projectKey: string;
  submissionClient: SupportSubmissionClient;
  position?: WidgetPosition;
  theme?: WidgetTheme;
  categories?: readonly SupportCategory[];
  title?: string;
  defaultOpen?: boolean;
}
