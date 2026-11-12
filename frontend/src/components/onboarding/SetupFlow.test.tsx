import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupFlow from "./SetupFlow";

const statusMutate = vi.fn();
const favoriteMutate = vi.fn();
const addService = vi.fn();

vi.mock("../../hooks/api/useSearch", () => ({
  usePopularMulti: () => ({
    isPending: false,
    data: {
      shows: [{ id: 1396, name: "Breaking Bad", poster_path: "/bb.jpg" }],
      movies: [{ id: 27205, title: "Inception", poster_path: "/in.jpg" }],
    },
  }),
  useSearch: () => ({ isPending: false, data: undefined }),
}));
vi.mock("../../hooks/api/useWatchActions", () => ({
  useUpdateWatchStatus: () => ({ mutate: statusMutate }),
}));
vi.mock("../../hooks/api/useLists", () => ({
  useToggleFavorite: () => ({ mutate: favoriteMutate }),
}));
vi.mock("../../hooks/api/useStreamingServices", () => ({
  useAllProviders: () => ({
    isPending: false,
    data: [
      { id: 8, name: "Netflix", logo_path: "/n.jpg" },
      { id: 9, name: "Amazon Prime Video", logo_path: "/p.jpg" },
    ],
  }),
  useMyProviderIds: () => new Set<number>(),
  useAddStreamingService: () => ({ mutate: addService }),
  useRemoveStreamingService: () => ({ mutate: vi.fn() }),
}));

function renderFlow() {
  const onFinish = vi.fn();
  const onImport = vi.fn();
  render(<SetupFlow onFinish={onFinish} onImport={onImport} />);
  return { onFinish, onImport };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

describe("SetupFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts on currently watching, with shows only", async () => {
    renderFlow();
    expect(
      await screen.findByRole("dialog", { name: "What are you watching right now?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Breaking Bad" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inception" })).toBeNull();
  });

  it("saves a pick at once and undoes it when picked again", async () => {
    renderFlow();
    const tile = await screen.findByRole("button", { name: "Breaking Bad" });

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/1 picked/)).toBeInTheDocument();
    expect(statusMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentType: "tv", contentId: 1396, targetStatus: "Currently Watching" }),
      expect.anything(),
    );

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "false");
    expect(statusMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetStatus: "none" }),
      expect.anything(),
    );
  });

  it("puts watchlist picks on the watchlist and leaves out shows already marked watching", async () => {
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Breaking Bad" }));
    next();

    expect(await screen.findByRole("dialog", { name: "What do you want to watch?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Breaking Bad" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inception" }));
    expect(statusMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentType: "movie", contentId: 27205, targetStatus: "Want To Watch" }),
      expect.anything(),
    );
  });

  it("favorites and services save through their own hooks", async () => {
    renderFlow();
    next();
    next();
    fireEvent.click(await screen.findByRole("button", { name: "Inception" }));
    expect(favoriteMutate).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "movie", contentId: 27205, favorited: false }),
      expect.anything(),
    );

    next();
    fireEvent.click(await screen.findByRole("button", { name: "Netflix" }));
    expect(addService).toHaveBeenCalledWith(8);
  });

  it("can be skipped from any step, and ends on the import offer", async () => {
    const { onFinish, onImport } = renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Skip setup" }));
    expect(onFinish).toHaveBeenCalledTimes(1);

    next();
    next();
    next();
    next();
    expect(await screen.findByRole("dialog", { name: "Coming from Letterboxd?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import from Letterboxd" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start the tour" }));
    expect(onFinish).toHaveBeenCalledTimes(2);
  });
});
