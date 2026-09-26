import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("platform shell", () => {
  it("identifies the application", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "AI Support Platform" }),
    ).toBeTruthy();
  });
});
