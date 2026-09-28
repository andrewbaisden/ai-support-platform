// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createResendSender,
  EmailDeliveryError,
  emailSenderFromEnv,
} from "./email";
import { authEmailOptions } from "./email-options";

const API_KEY = "re_test_0123456789abcdefghijklmnop";

function fakeFetch(status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "email-1" }), { status }),
  );
}

describe("Resend email sender", () => {
  it("posts one plain-text message with bearer auth", async () => {
    const fetchImpl = fakeFetch();
    const sender = createResendSender({
      apiKey: API_KEY,
      from: "IssueRelay <no-reply@mail.example.test>",
      fetchImpl,
    });
    await sender.send({
      to: "owner@example.test",
      subject: "Verify your email",
      text: "Open https://app.example.test/verify",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "IssueRelay <no-reply@mail.example.test>",
      to: ["owner@example.test"],
      subject: "Verify your email",
      text: "Open https://app.example.test/verify",
    });
  });

  it("fails with a status-only error that never carries the API key", async () => {
    const sender = createResendSender({
      apiKey: API_KEY,
      from: "IssueRelay <no-reply@mail.example.test>",
      fetchImpl: fakeFetch(403),
    });
    const error = await sender
      .send({ to: "owner@example.test", subject: "s", text: "t" })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).status).toBe(403);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(String(error)).not.toContain(API_KEY);
  });

  it("is configured only when both the API key and sender address exist", () => {
    expect(emailSenderFromEnv({})).toBeUndefined();
    expect(emailSenderFromEnv({ RESEND_API_KEY: API_KEY })).toBeUndefined();
    expect(
      emailSenderFromEnv({ EMAIL_FROM: "IssueRelay <a@mail.example.test>" }),
    ).toBeUndefined();
    expect(
      emailSenderFromEnv({
        RESEND_API_KEY: API_KEY,
        EMAIL_FROM: "IssueRelay <a@mail.example.test>",
      }),
    ).toBeDefined();
  });
});

describe("auth email options", () => {
  it("keeps local development unverified and without reset when email is off", () => {
    expect(authEmailOptions(undefined)).toEqual({
      emailAndPassword: { requireEmailVerification: false },
    });
  });

  it("requires verification and sends link-only emails when email is on", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const options = authEmailOptions({
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(options.emailAndPassword).toMatchObject({
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    });
    expect(options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    });
    const user = { email: "owner@example.test", name: "Owner" };
    await options.emailVerification?.sendVerificationEmail?.({
      user,
      url: "https://app.example.test/api/auth/verify-email?token=abc",
      token: "abc",
    } as never);
    await options.emailAndPassword.sendResetPassword?.({
      user,
      url: "https://app.example.test/api/auth/reset-password/abc",
      token: "abc",
    } as never);
    expect(sent.map((message) => [message.to, message.subject])).toEqual([
      ["owner@example.test", "Verify your IssueRelay email"],
      ["owner@example.test", "Reset your IssueRelay password"],
    ]);
    expect(sent[0]?.text).toContain(
      "https://app.example.test/api/auth/verify-email?token=abc",
    );
    expect(sent[1]?.text).toContain(
      "https://app.example.test/api/auth/reset-password/abc",
    );
  });
});
