import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Footer from "./Footer";
import { useAuthUser } from "../hooks/useAuthUser";

vi.mock("../hooks/useAuthUser", () => ({ useAuthUser: vi.fn() }));

const mockedUser = vi.mocked(useAuthUser);

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe("Footer", () => {
  beforeEach(() => {
    mockedUser.mockReturnValue(null as never);
  });

  it("shows the TMDB logo linking to themoviedb.org", () => {
    renderFooter();
    const logo = screen.getByRole("img", { name: /TMDB/ });
    expect(logo).toHaveAttribute("src", "/tmdb-logo.svg");
    const link = logo.closest("a");
    expect(link).toHaveAttribute("href", "https://www.themoviedb.org");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("credits JustWatch with a link", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: "JustWatch" })).toHaveAttribute(
      "href",
      "https://www.justwatch.com",
    );
  });

  it("includes the TMDB non-endorsement notice", () => {
    renderFooter();
    expect(
      screen.getByText(
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      ),
    ).toBeInTheDocument();
  });

  it("hides Settings when signed out", () => {
    renderFooter();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("shows Settings when signed in", () => {
    mockedUser.mockReturnValue({ uid: "u1" } as never);
    renderFooter();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
