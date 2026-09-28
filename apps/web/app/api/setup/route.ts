import { handleSetupPost, liveSetupDependencies } from "../../../lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSetupPost(request, liveSetupDependencies());
}
