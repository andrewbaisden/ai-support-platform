import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  EMAIL_PATTERN,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  type SupportCategory,
  supportCategories,
} from "@ai-support-platform/support-contracts/constants";
import type { FieldErrors, Resolver } from "react-hook-form";

export interface SupportFormValues {
  category: SupportCategory;
  message: string;
  name: string;
  email: string;
}

type FieldMessages = Partial<Record<keyof SupportFormValues, string>>;

/**
 * Dependency-free form validation mirroring the server's submission
 * contract (a drift test compares both). The widget avoids Zod at runtime:
 * its eval-support probe is reported as a violation on strict-CSP hosts.
 */
export function validateSupportForm(input: Partial<SupportFormValues>): {
  values: SupportFormValues;
  errors: FieldMessages;
} {
  const errors: FieldMessages = {};
  const category = input.category;
  if (!category || !supportCategories.includes(category)) {
    errors.category = "Choose a topic.";
  }
  const message = input.message ?? "";
  if (
    message.length < MESSAGE_MIN_LENGTH ||
    message.trim().length < MESSAGE_MIN_LENGTH
  ) {
    errors.message = `Tell us a little more (at least ${MESSAGE_MIN_LENGTH} characters).`;
  } else if (message.length > MESSAGE_MAX_LENGTH) {
    errors.message = "Keep your message under 10,000 characters.";
  }
  const name = (input.name ?? "").trim();
  if (name.length > CONTACT_NAME_MAX_LENGTH) {
    errors.name = `Keep your name under ${CONTACT_NAME_MAX_LENGTH} characters.`;
  }
  const email = input.email ?? "";
  if (email !== "" && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  } else if (email.length > CONTACT_EMAIL_MAX_LENGTH) {
    errors.email = "Email is too long.";
  }
  return {
    values: { category: category as SupportCategory, message, name, email },
    errors,
  };
}

export const supportFormResolver: Resolver<SupportFormValues> = async (
  input,
) => {
  const { values, errors } = validateSupportForm(input);
  const entries = Object.entries(errors);
  if (entries.length === 0) return { values, errors: {} };
  return {
    values: {},
    errors: Object.fromEntries(
      entries.map(([field, message]) => [field, { type: "validate", message }]),
    ) as FieldErrors<SupportFormValues>,
  };
};
