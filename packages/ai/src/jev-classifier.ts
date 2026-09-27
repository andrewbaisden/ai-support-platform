import {
  choice,
  type Fetch,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import {
  classificationResultSchema,
  severitySchema,
  type TicketClassificationInput,
  type TicketClassificationResult,
  type TicketClassifier,
  ticketTypeSchema,
} from "./classifier";
import { JEV_REQUEST_TIMEOUT_MS, TRIAGE_QUESTION_SET_VERSION } from "./config";
import { AiError, mapJevError } from "./errors";

/** Runtime shape check against SDK drift; never trusts provider output directly. */
const jevAnswersSchema = z.object({
  ticket_type: z.object({
    choice: z.string(),
    confidence: z.number(),
    probabilities: z.record(z.string(), z.number()),
  }),
  severity: z.object({
    choice: z.string(),
  }),
  model: z.string().min(1),
});

export interface JevClassifierOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: Fetch;
}

/**
 * Bounded Jev triage adapter. Asks one `systemOne` call with two choice
 * questions (type, severity) against the visitor message plus category hint.
 * Sends no contact details, IDs, or secrets. Never generates prose.
 */
export class JevTicketClassifier implements TicketClassifier {
  private readonly client: TypeSafeClient;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(options: JevClassifierOptions) {
    if (!options.apiKey) {
      throw new AiError("AI_MISCONFIGURED", "Jev API key is required");
    }
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? JEV_REQUEST_TIMEOUT_MS;
    try {
      this.client = new TypeSafeClient({
        apiKey: options.apiKey,
        // Never debug-log request bodies: they contain visitor text.
        logLevel: "warn",
        timeout: this.timeoutMs,
        fetch: options.fetchImpl,
      });
    } catch (error) {
      if (error instanceof TypeSafeError) {
        throw new AiError("AI_MISCONFIGURED", error.message, {
          cause: error,
        });
      }
      throw error;
    }
  }

  async classify(
    input: TicketClassificationInput,
  ): Promise<TicketClassificationResult> {
    let raw: unknown;
    try {
      const response = await this.client.systemOne(
        {
          state: {
            message: input.message,
            category_hint: input.categoryHint ?? null,
          },
          questions: {
            ticket_type: choice(
              "What kind of support ticket is this? The visitor-selected category hint is a weak signal, not ground truth: judge from the message content.",
              {
                question:
                  "The visitor asks how something works or what something is.",
                bug: "Something is broken, errors, or behaves incorrectly.",
                feature_request:
                  "The visitor requests new functionality or an improvement.",
                account:
                  "The visitor has an account access, login, or profile problem.",
                billing:
                  "The visitor has a payment, invoice, subscription, or refund problem.",
                feedback:
                  "The visitor shares an opinion or experience without requesting action.",
                spam: "Unsolicited advertising, scams, or irrelevant bulk content.",
                other: "A genuine request that fits none of the above.",
              },
            ),
            severity: choice("How urgent is this ticket?", {
              low: "Minor inconvenience, cosmetic issue, or general question.",
              medium:
                "Broken functionality with a workaround, or a routine request.",
              high: "Major functionality unavailable, no workaround, time-sensitive.",
              critical:
                "Security breach, data loss, privacy exposure, or billing harm.",
            }),
          },
          ...(this.model ? { model: this.model } : {}),
        },
        { timeout: this.timeoutMs },
      );
      raw = {
        ticket_type: response.answers.ticket_type,
        severity: response.answers.severity,
        model: response.model,
      };
    } catch (error) {
      throw mapJevError(error);
    }

    const parsed = jevAnswersSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AiError(
        "AI_SCHEMA_VALIDATION_FAILED",
        "Jev response did not match the expected answer shape",
      );
    }
    const type = ticketTypeSchema.safeParse(parsed.data.ticket_type.choice);
    const severity = severitySchema.safeParse(parsed.data.severity.choice);
    const probability =
      parsed.data.ticket_type.probabilities[parsed.data.ticket_type.choice];
    if (!type.success || !severity.success) {
      throw new AiError(
        "AI_SCHEMA_VALIDATION_FAILED",
        "Jev returned a type or severity outside the allowed sets",
      );
    }
    // Normalized confidence is the provider probability of the selected type
    // label, not the reported aggregate; it must be present and in range.
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new AiError(
        "AI_SCHEMA_VALIDATION_FAILED",
        "Jev did not report a usable probability for the selected type",
      );
    }
    return classificationResultSchema.parse({
      type: type.data,
      severity: severity.data,
      confidence: probability,
      provider: "jev",
      model: parsed.data.model,
    });
  }
}

export { TRIAGE_QUESTION_SET_VERSION };
