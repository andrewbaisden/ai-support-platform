import { loadRootEnv } from "@ai-support-platform/db";
import { productionConfigProblems } from "./lib/production-config";

export function assertProductionConfig() {
  loadRootEnv();
  const problems = productionConfigProblems(process.env);
  if (problems.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n- ${problems.join("\n- ")}`,
    );
  }
}
