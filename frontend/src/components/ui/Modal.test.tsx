import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Modal from "./Modal";

describe("Modal", () => {
  it("is a modal dialog named by its title and description", async () => {
    render(
      <Modal open onClose={() => {}} title="Report review" description="Tell us what's wrong.">
        <button>Send</button>
      </Modal>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Report review" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Tell us what's wrong.");
  });

  it("closes on Escape and from the labelled close button", async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Sync calendar" />);
    const dialog = await screen.findByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("must be answered when not dismissible", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Account warning" dismissible={false}>
        <button>I understand</button>
      </Modal>,
    );
    const dialog = await screen.findByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("keeps a hidden title for screen readers", async () => {
    render(<Modal open onClose={() => {}} title="Trailer" hideTitle variant="bare" />);
    expect(await screen.findByRole("dialog", { name: "Trailer" })).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
