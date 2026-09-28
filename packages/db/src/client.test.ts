import { afterEach, describe, expect, it, vi } from "vitest";
import { getSharedDatabase, poolSizeFromEnv } from "./client";

const URL_A = "postgresql://u:p@127.0.0.1:5432/pool_a";
const URL_B = "postgresql://u:p@127.0.0.1:5432/pool_b";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("process database pool", () => {
  it("shares one pool per connection string across callers", async () => {
    const first = getSharedDatabase(URL_A);
    const second = getSharedDatabase(URL_A);
    const other = getSharedDatabase(URL_B);
    expect(second.pool).toBe(first.pool);
    expect(second.db).toBe(first.db);
    expect(other.pool).not.toBe(first.pool);
    // Pools connect lazily; nothing was opened.
    expect(first.pool.totalCount).toBe(0);
    await Promise.all([first.pool.end(), other.pool.end()]);
  });

  it("sizes pools from DATABASE_POOL_MAX within safe bounds", () => {
    vi.stubEnv("DATABASE_POOL_MAX", "");
    expect(poolSizeFromEnv()).toBe(5);
    vi.stubEnv("DATABASE_POOL_MAX", "12");
    expect(poolSizeFromEnv()).toBe(12);
    for (const invalid of ["0", "-1", "51", "2.5", "many"]) {
      vi.stubEnv("DATABASE_POOL_MAX", invalid);
      expect(() => poolSizeFromEnv(), invalid).toThrow(/DATABASE_POOL_MAX/);
    }
  });
});
