import { loadRootEnv } from "@ai-support-platform/db";
import {
  issuesWebhookSchema,
  processGitHubWebhook,
  verifyWebhookSignature,
  type WebhookRepository,
  webhookTransactionFromScope,
} from "@ai-support-platform/github";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupportRepository } from "../../../../lib/support-runtime";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1024 * 1024;
const headersSchema = z.object({
  deliveryId: z.uuid(),
  eventType: z.string().trim().min(1).max(80),
});

async function readLimitedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing_body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  if (length === 0) throw new Error("missing_body");
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function webhookRepository(): WebhookRepository {
  const repository = getSupportRepository();
  return {
    withDelivery: (delivery, process) =>
      repository.withGitHubWebhookDelivery(
        {
          deliveryId: delivery.deliveryId,
          eventType: delivery.eventType,
          ...(delivery.action ? { action: delivery.action } : {}),
          ...(delivery.repositoryId
            ? { repositoryId: BigInt(delivery.repositoryId) }
            : {}),
          ...(delivery.installationId
            ? { installationId: BigInt(delivery.installationId) }
            : {}),
          ...(delivery.githubIssueId
            ? { githubIssueId: BigInt(delivery.githubIssueId) }
            : {}),
        },
        (scope) => process(webhookTransactionFromScope(scope)),
      ),
  };
}

const noStore = { "Cache-Control": "no-store" };
function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function POST(request: Request) {
  loadRootEnv();
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret)
    return reply({ ok: false, error: "WEBHOOK_NOT_CONFIGURED" }, 503);
  const header = headersSchema.safeParse({
    deliveryId: request.headers.get("x-github-delivery"),
    eventType: request.headers.get("x-github-event"),
  });
  if (!header.success)
    return reply({ ok: false, error: "INVALID_DELIVERY" }, 400);
  let raw: Uint8Array;
  try {
    raw = await readLimitedBody(request);
  } catch (error) {
    return reply(
      { ok: false, error: "INVALID_BODY" },
      error instanceof Error && error.message === "body_too_large" ? 413 : 400,
    );
  }
  // GitHub signs the exact bytes, including whitespace and encoding.
  if (
    !verifyWebhookSignature({
      secret,
      rawBody: raw,
      signatureHeader: request.headers.get("x-hub-signature-256"),
    })
  ) {
    return reply({ ok: false, error: "INVALID_SIGNATURE" }, 401);
  }
  const { deliveryId, eventType } = header.data;
  try {
    if (eventType !== "issues" && eventType !== "ping") {
      const outcome = await processGitHubWebhook(webhookRepository(), {
        delivery: { deliveryId, eventType },
        action: "ignored",
        ignoredReason: "unsupported_event",
      });
      return reply({ ok: true, outcome: outcome.outcome });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(raw),
      );
    } catch {
      return reply({ ok: false, error: "INVALID_PAYLOAD" }, 400);
    }
    if (eventType === "ping") {
      const outcome = await processGitHubWebhook(webhookRepository(), {
        delivery: { deliveryId, eventType },
        action: "ping",
      });
      return reply({ ok: true, outcome: outcome.outcome });
    }
    const payload = issuesWebhookSchema.safeParse(parsed);
    if (!payload.success) {
      const outcome = await processGitHubWebhook(webhookRepository(), {
        delivery: { deliveryId, eventType },
        action: "ignored",
        ignoredReason: "invalid_payload",
      });
      return reply({ ok: true, outcome: outcome.outcome });
    }
    const issue = payload.data;
    const action =
      issue.action === "closed" || issue.action === "reopened"
        ? issue.action
        : "ignored";
    const outcome = await processGitHubWebhook(webhookRepository(), {
      delivery: {
        deliveryId,
        eventType,
        action: issue.action,
        repositoryId: String(issue.repository.id),
        ...(issue.installation
          ? { installationId: String(issue.installation.id) }
          : {}),
        githubIssueId: String(issue.issue.id),
      },
      action,
      ...(action === "ignored" ? { ignoredReason: "unsupported_action" } : {}),
      ...(issue.installation
        ? { installationId: String(issue.installation.id) }
        : {}),
      issue: {
        repositoryId: String(issue.repository.id),
        githubIssueId: String(issue.issue.id),
        issueNumber: issue.issue.number,
        issueState: issue.issue.state,
        ...(issue.issue.updated_at
          ? { updatedAt: issue.issue.updated_at }
          : {}),
      },
    });
    console.info("github_webhook", {
      deliveryId,
      eventType,
      action: issue.action,
      repositoryId: issue.repository.id,
      issueNumber: issue.issue.number,
      outcome: outcome.outcome,
    });
    return reply({ ok: true, outcome: outcome.outcome });
  } catch {
    return reply({ ok: false, error: "PROCESSING_FAILED" }, 503);
  }
}
