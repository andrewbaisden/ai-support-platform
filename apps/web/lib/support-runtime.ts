import {
  createDatabase,
  createSupportRepository,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";

let repository: ReturnType<typeof createSupportRepository> | undefined;

export function getSupportRepository() {
  if (!repository) {
    loadRootEnv();
    const { db } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
    repository = createSupportRepository(db);
  }
  return repository;
}
