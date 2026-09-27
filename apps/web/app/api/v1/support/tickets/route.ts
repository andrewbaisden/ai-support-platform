import {
  handleTicketOptions,
  handleTicketPost,
} from "../../../../../lib/support-route";
import { getSupportRepository } from "../../../../../lib/support-runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return await handleTicketPost(request, getSupportRepository());
  } catch {
    return Response.json(
      { error: { code: "SUBMISSION_FAILED" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function OPTIONS(request: Request) {
  try {
    return await handleTicketOptions(request, getSupportRepository());
  } catch {
    return Response.json(
      { error: { code: "SUBMISSION_FAILED" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
