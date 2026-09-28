import { z } from "zod";
import { scopeErrorResponse } from "../../../../../../lib/dashboard-api";
import {
  handleProjectSettingsPost,
  liveProjectSettingsDependencies,
} from "../../../../../../lib/project-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ projectId: z.uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return scopeErrorResponse("NOT_FOUND");
  return handleProjectSettingsPost(
    request,
    params.data.projectId,
    liveProjectSettingsDependencies(),
  );
}
