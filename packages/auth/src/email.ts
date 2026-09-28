export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Server-only port for account emails; the dashboard never sees providers. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Delivery failure carrying only the provider's HTTP status. */
export class EmailDeliveryError extends Error {
  constructor(public readonly status?: number) {
    super(
      status === undefined
        ? "Email delivery failed"
        : `Email delivery failed (${status})`,
    );
    this.name = "EmailDeliveryError";
  }
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/**
 * Resend adapter over its HTTP API (no SDK). Plain-text messages only: they
 * carry a greeting and a link, never ticket or visitor content.
 */
export function createResendSender(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  return {
    async send(message) {
      // Bare call so native fetch keeps an undefined receiver.
      const fetchImpl = options.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new EmailDeliveryError();
      }
      if (!response.ok) throw new EmailDeliveryError(response.status);
    },
  };
}

/** A sender only when both RESEND_API_KEY and EMAIL_FROM are set. */
export function emailSenderFromEnv(
  env: Record<string, string | undefined>,
): EmailSender | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return undefined;
  return createResendSender({ apiKey, from });
}
