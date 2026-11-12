import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PageState from "./PageState";
import { ApiError } from "../../hooks/api/errors";

function renderState(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PageState", () => {
  it("says a 404 wasn't found, offers no retry, and links back", () => {
    renderState(
      <PageState
        status="error"
        error={new ApiError(404, "/tv/1/season/9/info")}
        subject="season"
        back={{ to: "/tv/1", label: "Back to show" }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("We couldn't find this season")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to show/i })).toHaveAttribute("href", "/tv/1");
  });

  it("never shows the error's own message", () => {
    renderState(
      <PageState status="error" error={new ApiError(500, "/tv/1/full")} subject="show" />,
    );
    expect(screen.queryByText(/API error/)).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load this show")).toBeInTheDocument();
  });

  it("words a network failure as a connection problem and retries", () => {
    const onRetry = vi.fn();
    renderState(
      <PageState
        status="error"
        error={new TypeError("Failed to fetch")}
        subject="movie"
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByText("Can't connect right now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/");
  });
});
