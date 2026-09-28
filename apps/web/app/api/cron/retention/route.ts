import { timingSafeEqual } from "node:crypto";
import { retentionCutoffs } from "@ai-support-platform/db";
import { NextResponse } from "next/server";
import { getSupportRepository } from "../../../../lib/support-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Daily retention (ADR-025), triggered by Vercel Cron with
 * `Authorization: Bearer $CRON_SECRET`. Same policy as
 * `pnpm db:retention --apply`; logs counts only.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const repository = getSupportRepository();
  const { resolvedBefore, receivedBefore } = retentionCutoffs();
  const contacts = await repository.eraseResolvedContactDetails({
    resolvedBefore,
  });
  const deliveries = await repository.deleteWebhookDeliveries({
    receivedBefore,
  });
  const result = {
    contactDetailsErased: contacts.tickets,
    webhookDeliveriesDeleted: deliveries.deliveries,
  };
  console.info(JSON.stringify({ event: "retention_applied", ...result }));
  return NextResponse.json({ ok: true, ...result });
}
