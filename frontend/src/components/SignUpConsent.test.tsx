import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SignUpConsent from "./SignUpConsent";

describe("SignUpConsent", () => {
  it("leads with the action in the consent sentence", () => {
    const { container } = render(
      <SignUpConsent lead="By selecting Create account" />,
    );
    expect(container.textContent).toBe(
      "By selecting Create account, you agree to our Terms of Service and acknowledge our Privacy Policy.",
    );
  });

  it.each([
    ["Terms of Service", "/terms"],
    ["Privacy Policy", "/privacy"],
  ])("links %s to %s in a new tab safely", (name, href) => {
    render(<SignUpConsent lead="By selecting Sign up" />);
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
