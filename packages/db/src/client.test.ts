import { afterEach, describe, expect, it, vi } from "vitest";
import { getSharedDatabase, poolSizeFromEnv } from "./client";
import { withExplicitSslMode } from "./ssl-mode";

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

describe("withExplicitSslMode", () => {
  it("spells out verify-full for pg's aliases and leaves the rest alone", () => {
    const neon =
      "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    expect(withExplicitSslMode(neon)).toBe(
      "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
    );
    for (const unchanged of [
      URL_A,
      `${URL_A}?sslmode=disable`,
      `${URL_A}?sslmode=verify-full`,
      `${URL_A}?uselibpqcompat=true&sslmode=require`,
      "not a url",
    ]) {
      expect(withExplicitSslMode(unchanged)).toBe(unchanged);
    }
  });
});
