export type { SupportCategory } from "@ai-support-platform/support-contracts";
export { supportCategories } from "@ai-support-platform/support-contracts";

import type { SupportCategory } from "@ai-support-platform/support-contracts";
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
