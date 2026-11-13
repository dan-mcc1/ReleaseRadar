import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServicesPage from "./ServicesPage";
import {
  useServicePopular,
  useServicesOverview,
  useSetServicePaused,
  type ServiceOverview,
} from "../hooks/api/useStreamingServices";

vi.mock("../hooks/api/useStreamingServices", () => ({
  useServicesOverview: vi.fn(),
  useServicePopular: vi.fn(),
  useSetServicePaused: vi.fn(),
}));
vi.mock("../components/StreamingOptimizer", () => ({ default: () => <div>optimizer</div> }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const mutate = vi.fn();

function svc(over: Partial<ServiceOverview>): ServiceOverview {
  return {
    id: 8,
    name: "Netflix",
    logo_path: null,
    paused_at: null,
    verdict: "keep",
    upcoming: [],
    upcoming_count: 0,
    next_release: null,
    next_premiere: null,
    ready_now: { count: 0, items: [] },
    last_used: null,
    ...over,
  };
}

function renderWith(services: ServiceOverview[]) {
  vi.mocked(useServicesOverview).mockReturnValue({
    data: { lookahead_days: 90, recent_use_days: 30, services },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  return render(
    <MemoryRouter>
      <ServicesPage />
    </MemoryRouter>,
  );
}

describe("ServicesPage", () => {
  beforeEach(() => {
    mutate.mockReset();
    vi.mocked(useSetServicePaused).mockReturnValue({ mutate, isPending: false } as never);
    vi.mocked(useServicePopular).mockReturnValue({
      data: [{ content_type: "tv", id: 5, title: "Popular Show", poster_path: "/p.jpg", year: "2025", vote_average: 8 }],
      isPending: false,
      isError: false,
    } as never);
  });

  it("puts the service worth pausing first and summarizes", () => {
    renderWith([
      svc({ id: 8, name: "Netflix", verdict: "keep", upcoming_count: 1, upcoming: [{
        content_type: "tv", id: 1, title: "Stranger Things", poster_path: null, date: "2099-01-01",
        kind: "season_premiere", season_number: 5, episode_number: 1,
      }] }),
      svc({ id: 15, name: "Hulu", verdict: "pause" }),
    ]);
    const cards = screen.getAllByRole("article");
    expect(within(cards[0]).getByRole("heading", { name: "Hulu" })).toBeInTheDocument();
    expect(screen.getByText("2 services · 1 you could pause")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Season 5 premiere")).toBeInTheDocument();
  });

  it("opens popular titles on a quiet service only", () => {
    renderWith([svc({ id: 15, name: "Hulu", verdict: "pause" }), svc({ id: 8, name: "Netflix" })]);
    const [hulu, netflix] = screen.getAllByRole("article");
    expect(within(hulu).getByText("Popular Show")).toBeInTheDocument();
    expect(within(netflix).queryByText("Popular Show")).not.toBeInTheDocument();
    fireEvent.click(within(netflix).getByRole("button", { name: /popular on netflix/i }));
    expect(within(netflix).getByText("Popular Show")).toBeInTheDocument();
  });

  it("pauses and resumes", () => {
    renderWith([svc({ id: 15, name: "Hulu", verdict: "pause" }), svc({ id: 8, verdict: "paused", paused_at: "2026-11-01T00:00:00Z" })]);
    fireEvent.click(screen.getByRole("button", { name: "Mark as paused" }));
    expect(mutate.mock.calls[0][0]).toEqual({ providerId: 15, paused: true });
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(mutate.mock.calls[1][0]).toEqual({ providerId: 8, paused: false });
  });

  it("leads with the picker when no services are saved", () => {
    renderWith([]);
    expect(screen.getByText("Add the services you pay for")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose services" })).toHaveAttribute("href", "/settings#streaming");
  });
});
