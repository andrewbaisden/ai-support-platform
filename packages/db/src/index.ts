export { createDatabase, type Database } from "./client";
export { loadRootEnv, requireDatabaseUrl } from "./env";
export {
  type ClassificationInput,
  classificationInputSchema,
  generatePublicProjectKey,
  type ProjectInput,
  projectInputSchema,
  type SubmissionInput,
  submissionInputSchema,
} from "./inputs";
export {
  createSupportRepository,
  SubmissionConflictError,
  ticketReference,
} from "./repository";
export type { Severity, TicketRoute, TicketStatus, TicketType } from "./schema";
