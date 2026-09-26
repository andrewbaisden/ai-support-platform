import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportWidget } from "./support-widget";
import type { SupportSubmissionClient } from "./types";

const message = "The projects page is blank in Safari dark mode.";

function setup(
  client: SupportSubmissionClient = {
    submit: vi.fn().mockResolvedValue({ reference: "SUP-DEMO-001" }),
  },
) {
  const rendered = render(
    <SupportWidget projectKey="pk_demo" submissionClient={client} />,
  );
  const host = rendered.container.firstElementChild as HTMLElement;
  const root = host.shadowRoot;
  if (!root) throw new Error("Widget ShadowRoot not mounted");
  return {
    ...rendered,
    ui: within(root as unknown as HTMLElement),
    root,
    client,
  };
}

function openBugForm(ui: ReturnType<typeof setup>["ui"]) {
  fireEvent.click(ui.getByRole("button", { name: "Open support" }));
  fireEvent.click(ui.getByRole("button", { name: /Report a bug/ }));
}

afterEach(() => vi.restoreAllMocks());

describe("SupportWidget", () => {
  it("opens, focuses the first topic, closes on Escape, and returns focus", async () => {
    const { ui, root } = setup();
    const launcher = ui.getByRole("button", { name: "Open support" });
    fireEvent.click(launcher);
    const bug = ui.getByRole("button", { name: /Report a bug/ });
    expect(ui.getByRole("dialog")).toBeTruthy();
    expect(ui.getByRole("button", { name: /Ask a question/ })).toBeTruthy();
    expect(ui.getByRole("button", { name: /Suggest a feature/ })).toBeTruthy();
    expect(ui.getByRole("button", { name: /Ask a question/ })).toBe(
      root.activeElement,
    );
    fireEvent.keyDown(bug, { key: "Escape" });
    await waitFor(() =>
      expect(ui.getByRole("button", { name: "Open support" })).toBe(
        root.activeElement,
      ),
    );
  });

  it("validates message and optional email before submission", async () => {
    const client = {
      submit: vi.fn().mockResolvedValue({ reference: "SUP-DEMO-001" }),
    };
    const { ui } = setup(client);
    openBugForm(ui);
    fireEvent.click(ui.getByRole("button", { name: "Send message" }));
    expect(await ui.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("at least 10"),
    );
    fireEvent.change(ui.getByRole("textbox", { name: "Message" }), {
      target: { value: message },
    });
    fireEvent.change(ui.getByRole("textbox", { name: "Email (optional)" }), {
      target: { value: "invalid" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Send message" }));
    expect(await ui.findByText("Enter a valid email address.")).toBeTruthy();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it("submits a selected category and optional contact details, then confirms", async () => {
    const client = {
      submit: vi.fn().mockResolvedValue({ reference: "SUP-DEMO-001" }),
    };
    const { ui } = setup(client);
    openBugForm(ui);
    fireEvent.change(ui.getByRole("textbox", { name: "Message" }), {
      target: { value: message },
    });
    fireEvent.change(ui.getByRole("textbox", { name: "Name (optional)" }), {
      target: { value: "Andrew" },
    });
    fireEvent.change(ui.getByRole("textbox", { name: "Email (optional)" }), {
      target: { value: "andrew@example.com" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Send message" }));
    expect(await ui.findByText("Message received")).toBeTruthy();
    expect(ui.getByText("SUP-DEMO-001")).toBeTruthy();
    expect(client.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "bug",
        message,
        name: "Andrew",
        email: "andrew@example.com",
        projectKey: "pk_demo",
        idempotencyKey: expect.any(String),
      }),
    );
    fireEvent.click(ui.getByRole("button", { name: "Send another message" }));
    expect(ui.getByRole("button", { name: /Ask a question/ })).toBeTruthy();
  });

  it("shows a safe error, preserves the draft, and retries with the same key", async () => {
    const client = {
      submit: vi
        .fn()
        .mockRejectedValueOnce(new Error("private server error"))
        .mockResolvedValueOnce({ reference: "SUP-DEMO-002" }),
    };
    const { ui } = setup(client);
    openBugForm(ui);
    fireEvent.change(ui.getByRole("textbox", { name: "Message" }), {
      target: { value: message },
    });
    fireEvent.click(ui.getByRole("button", { name: "Send message" }));
    expect(
      await ui.findByText("We couldn’t send your message. Please try again."),
    ).toBeTruthy();
    expect(ui.queryByText("private server error")).toBeNull();
    expect(
      (ui.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe(message);
    fireEvent.click(ui.getByRole("button", { name: "Try again" }));
    expect(await ui.findByText("SUP-DEMO-002")).toBeTruthy();
    expect(client.submit.mock.calls[0]?.[0].idempotencyKey).toBe(
      client.submit.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("disables duplicate submission while the request is pending", async () => {
    let finish: ((value: { reference: string }) => void) | undefined;
    const client = {
      submit: vi.fn(
        () =>
          new Promise<{ reference: string }>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const { ui } = setup(client);
    openBugForm(ui);
    fireEvent.change(ui.getByRole("textbox", { name: "Message" }), {
      target: { value: message },
    });
    fireEvent.click(ui.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(
        (ui.getByRole("button", { name: "Sending…" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    fireEvent.click(ui.getByRole("button", { name: "Sending…" }));
    expect(client.submit).toHaveBeenCalledTimes(1);
    finish?.({ reference: "SUP-DEMO-003" });
    expect(await ui.findByText("SUP-DEMO-003")).toBeTruthy();
  });
});
