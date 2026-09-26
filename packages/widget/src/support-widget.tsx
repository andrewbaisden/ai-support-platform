"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { widgetStyles } from "./styles";
import {
  type SupportCategory,
  type SupportWidgetProps,
  supportCategories,
  type WidgetTheme,
} from "./types";
import { type SupportFormValues, supportFormSchema } from "./validation";

const categoryDetails: Record<
  SupportCategory,
  { title: string; description: string; prompt: string }
> = {
  question: {
    title: "Ask a question",
    description: "Get help or learn more",
    prompt: "What would you like to know?",
  },
  bug: {
    title: "Report a bug",
    description: "Tell us what went wrong",
    prompt: "What happened? What did you expect instead?",
  },
  feature_request: {
    title: "Suggest a feature",
    description: "Share an idea for improvement",
    prompt: "What would you like to see?",
  },
};

function MessageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20 11.5a8 8 0 0 1-8 8 8.6 8.6 0 0 1-3.1-.6L4 20l1.1-4.9A8 8 0 1 1 20 11.5Z" />
      <path d="M8 11.5h8M8 14.5h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function useResolvedTheme(theme: WidgetTheme) {
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function SupportWidget({
  projectKey,
  submissionClient,
  position = "bottom-right",
  theme = "system",
  categories = supportCategories,
  title = "How can we help?",
  defaultOpen = false,
}: SupportWidgetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const hasOpened = useRef(defaultOpen);
  const attemptRef = useRef<{ content: string; key: string } | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [screen, setScreen] = useState<"categories" | "form" | "success">(
    "categories",
  );
  const [resultReference, setResultReference] = useState("");
  const [submissionError, setSubmissionError] = useState(false);
  const resolvedTheme = useResolvedTheme(theme);
  const id = useId().replaceAll(":", "");
  const availableCategories = categories.filter((category) =>
    supportCategories.includes(category),
  );
  const visibleCategories =
    availableCategories.length > 0 ? availableCategories : supportCategories;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SupportFormValues>({
    resolver: zodResolver(supportFormSchema),
    defaultValues: { message: "", name: "", email: "" },
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setShadow(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);

  useEffect(() => {
    if (!shadow) return;
    if (open) {
      hasOpened.current = true;
      const selector =
        screen === "form"
          ? "textarea"
          : screen === "success"
            ? ".submit"
            : ".choice";
      shadow.querySelector<HTMLElement>(selector)?.focus();
    } else if (hasOpened.current) {
      launcherRef.current?.focus();
    }
  }, [open, screen, shadow]);

  function chooseCategory(category: SupportCategory) {
    setValue("category", category, { shouldValidate: true });
    setScreen("form");
    setSubmissionError(false);
  }

  function close() {
    if (isSubmitting) return;
    setOpen(false);
  }

  async function submit(values: SupportFormValues) {
    setSubmissionError(false);
    const content = JSON.stringify(values);
    if (!attemptRef.current || attemptRef.current.content !== content) {
      attemptRef.current = { content, key: crypto.randomUUID() };
    }

    try {
      const result = await submissionClient.submit({
        projectKey,
        category: values.category,
        message: values.message,
        name: values.name || undefined,
        email: values.email || undefined,
        idempotencyKey: attemptRef.current.key,
      });
      setResultReference(result.reference);
      setScreen("success");
    } catch {
      setSubmissionError(true);
    }
  }

  function startAgain() {
    attemptRef.current = null;
    reset({ message: "", name: "", email: "" });
    setResultReference("");
    setSubmissionError(false);
    setScreen("categories");
  }

  const category = getValues("category");

  return (
    <div ref={hostRef} data-position={position}>
      {shadow &&
        createPortal(
          <>
            <style>{widgetStyles}</style>
            <div className="root" data-theme={resolvedTheme}>
              {!open ? (
                <button
                  ref={launcherRef}
                  className="launcher"
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-label="Open support"
                >
                  <MessageIcon /> Support
                </button>
              ) : (
                <section
                  className="panel"
                  role="dialog"
                  aria-modal="false"
                  aria-labelledby={`${id}-title`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      close();
                    }
                  }}
                >
                  <header className="header">
                    <div>
                      <p className="eyebrow">Support</p>
                      <h2 id={`${id}-title`}>{title}</h2>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={close}
                      disabled={isSubmitting}
                      aria-label="Close support"
                    >
                      <CloseIcon />
                    </button>
                  </header>
                  <div className="content">
                    {screen === "categories" && (
                      <>
                        <p className="lead">Choose what you need help with.</p>
                        <div className="choices">
                          {visibleCategories.map((item) => (
                            <button
                              className="choice"
                              type="button"
                              key={item}
                              onClick={() => chooseCategory(item)}
                            >
                              <span>
                                <strong>{categoryDetails[item].title}</strong>
                                <small>
                                  {categoryDetails[item].description}
                                </small>
                              </span>
                              <ArrowIcon />
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {screen === "form" && category && (
                      <>
                        <button
                          className="back"
                          type="button"
                          onClick={() => setScreen("categories")}
                          disabled={isSubmitting}
                        >
                          ← Change topic
                        </button>
                        <h3 className="form-title">
                          {categoryDetails[category].title}
                        </h3>
                        <form onSubmit={handleSubmit(submit)} noValidate>
                          <div className="field">
                            <label htmlFor={`${id}-message`}>Message</label>
                            <textarea
                              id={`${id}-message`}
                              placeholder={categoryDetails[category].prompt}
                              aria-invalid={Boolean(errors.message)}
                              aria-describedby={
                                errors.message
                                  ? `${id}-message-error`
                                  : `${id}-message-hint`
                              }
                              maxLength={10000}
                              {...register("message")}
                            />
                            {errors.message ? (
                              <p
                                className="error"
                                id={`${id}-message-error`}
                                role="alert"
                              >
                                {errors.message.message}
                              </p>
                            ) : (
                              <p className="hint" id={`${id}-message-hint`}>
                                At least 10 characters.
                              </p>
                            )}
                          </div>
                          <div className="contact-grid">
                            <div className="field">
                              <label htmlFor={`${id}-name`}>
                                Name (optional)
                              </label>
                              <input
                                id={`${id}-name`}
                                autoComplete="name"
                                aria-invalid={Boolean(errors.name)}
                                aria-describedby={
                                  errors.name ? `${id}-name-error` : undefined
                                }
                                {...register("name")}
                              />
                              {errors.name && (
                                <p
                                  className="error"
                                  id={`${id}-name-error`}
                                  role="alert"
                                >
                                  {errors.name.message}
                                </p>
                              )}
                            </div>
                            <div className="field">
                              <label htmlFor={`${id}-email`}>
                                Email (optional)
                              </label>
                              <input
                                id={`${id}-email`}
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                aria-invalid={Boolean(errors.email)}
                                aria-describedby={
                                  errors.email ? `${id}-email-error` : undefined
                                }
                                {...register("email")}
                              />
                              {errors.email && (
                                <p
                                  className="error"
                                  id={`${id}-email-error`}
                                  role="alert"
                                >
                                  {errors.email.message}
                                </p>
                              )}
                            </div>
                          </div>
                          <p className="privacy">
                            Your message and any contact details go to this
                            site’s owner so they can follow up.
                          </p>
                          {submissionError && (
                            <p className="status-error" role="alert">
                              We couldn’t send your message. Please try again.
                            </p>
                          )}
                          <button
                            className="submit"
                            type="submit"
                            disabled={isSubmitting}
                          >
                            {isSubmitting
                              ? "Sending…"
                              : submissionError
                                ? "Try again"
                                : "Send message"}
                          </button>
                        </form>
                      </>
                    )}
                    {screen === "success" && (
                      <div className="success" role="status">
                        <div className="success-mark" aria-hidden="true">
                          ✓
                        </div>
                        <h3>Message received</h3>
                        <p className="lead">
                          Thanks for reaching out. Your message has been sent to
                          the site owner.
                        </p>
                        <div className="reference">
                          Support reference<strong>{resultReference}</strong>
                        </div>
                        <button
                          className="submit"
                          type="button"
                          onClick={startAgain}
                        >
                          Send another message
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </>,
          shadow,
        )}
    </div>
  );
}
