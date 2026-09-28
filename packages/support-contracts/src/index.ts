import { z } from "zod";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  EMAIL_PATTERN,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  PUBLIC_PROJECT_KEY_PATTERN,
  publicErrorCodes,
  supportCategories,
  TICKET_REFERENCE_PATTERN,
} from "./constants";

export * from "./constants";

export const publicProjectKeySchema = z
  .string()
  .regex(PUBLIC_PROJECT_KEY_PATTERN);

export const ticketSubmissionRequestSchema = z.strictObject({
  projectKey: publicProjectKeySchema,
  category: z.enum(supportCategories),
  message: z
    .string()
    .min(MESSAGE_MIN_LENGTH)
    .max(MESSAGE_MAX_LENGTH)
    .refine((value) => value.trim().length >= MESSAGE_MIN_LENGTH),
  contact: z
    .strictObject({
      name: z.string().trim().max(CONTACT_NAME_MAX_LENGTH).optional(),
      email: z
        .email({ pattern: EMAIL_PATTERN })
        .max(CONTACT_EMAIL_MAX_LENGTH)
        .optional(),
    })
    .optional(),
  submissionId: z.uuid(),
});

export const ticketSubmissionResponseSchema = z.strictObject({
  ticketReference: z.string().regex(TICKET_REFERENCE_PATTERN),
  status: z.literal("received"),
});

export const publicErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(publicErrorCodes) }),
});

export type TicketSubmissionRequest = z.infer<
  typeof ticketSubmissionRequestSchema
>;
export type TicketSubmissionResponse = z.infer<
  typeof ticketSubmissionResponseSchema
>;
