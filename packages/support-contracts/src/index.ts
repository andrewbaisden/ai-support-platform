import { z } from "zod";

export const supportCategories = [
  "question",
  "bug",
  "feature_request",
] as const;
export type SupportCategory = (typeof supportCategories)[number];

export const publicProjectKeySchema = z
  .string()
  .regex(/^pk_[A-Za-z0-9_-]{32}$/);

export const ticketSubmissionRequestSchema = z.strictObject({
  projectKey: publicProjectKeySchema,
  category: z.enum(supportCategories),
  message: z
    .string()
    .min(10)
    .max(10_000)
    .refine((value) => value.trim().length >= 10),
  contact: z
    .strictObject({
      name: z.string().trim().max(120).optional(),
      email: z.email().max(320).optional(),
    })
    .optional(),
  submissionId: z.uuid(),
});

export const ticketSubmissionResponseSchema = z.strictObject({
  ticketReference: z.string().regex(/^SUP-[1-9][0-9]*$/),
  status: z.literal("received"),
});

export const publicErrorCodes = [
  "INVALID_REQUEST",
  "PROJECT_NOT_FOUND",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "SUBMISSION_CONFLICT",
  "SUBMISSION_FAILED",
  "BODY_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
] as const;

export const publicErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(publicErrorCodes) }),
});

export type TicketSubmissionRequest = z.infer<
  typeof ticketSubmissionRequestSchema
>;
export type TicketSubmissionResponse = z.infer<
  typeof ticketSubmissionResponseSchema
>;
export type PublicErrorCode = (typeof publicErrorCodes)[number];
