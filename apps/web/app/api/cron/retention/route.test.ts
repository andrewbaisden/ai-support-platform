// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "c9Xk2LmQ7vB4nR8tW1yZ5aD3fG6hJ0pS";
const repository = {
  eraseResolvedContactDetails: vi.fn(async () => ({ tickets: 2 })),
  deleteWebhookDeliveries: vi.fn(async () => ({ deliveries: 5 })),
};
vi.mock("../../../../lib/support-runtime", () => ({
  getSupportRepository: () => repository,
}));

const { GET } = await import("./route");

function call(authorization?: string) {
  return GET(
    new Request("https://platform.example.test/api/cron/retention", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  repository.eraseResolvedContactDetails.mockClear();
  repository.deleteWebhookDeliveries.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scheduled retention route", () => {
  it("applies the retention policy for Vercel Cron's bearer secret", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      contactDetailsErased: 2,
      webhookDeliveriesDeleted: 5,
    });
    const [contacts] = repository.eraseResolvedContactDetails.mock
      .calls[0] as unknown as [{ resolvedBefore: Date; dryRun?: boolean }];
    const [deliveries] = repository.deleteWebhookDeliveries.mock
      .calls[0] as unknown as [{ receivedBefore: Date; dryRun?: boolean }];
    const day = 24 * 60 * 60 * 1000;
    expect(
      Math.round((Date.now() - contacts.resolvedBefore.getTime()) / day),
    ).toBe(180);
    expect(
      Math.round((Date.now() - deliveries.receivedBefore.getTime()) / day),
    ).toBe(90);
    expect(contacts.dryRun).toBeUndefined();
  });

  it("rejects missing or wrong credentials without touching data", async () => {
    for (const header of [
      undefined,
      "Bearer wrong",
      SECRET,
      `Bearer ${SECRET}x`,
    ]) {
      const response = await call(header);
      expect(response.status, String(header)).toBe(401);
    }
    expect(repository.eraseResolvedContactDetails).not.toHaveBeenCalled();
  });

  it("refuses to run when no cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(503);
    expect(repository.deleteWebhookDeliveries).not.toHaveBeenCalled();
  });
});
