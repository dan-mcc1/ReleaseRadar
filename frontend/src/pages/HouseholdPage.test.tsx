import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdPage from "./HouseholdPage";
import {
  useHousehold,
  useHouseholdInvitable,
  useHouseholdProgress,
  useHouseholdRecommendations,
  type HouseholdDetail,
  type HouseholdProgress,
} from "../hooks/api/useHouseholds";

const inviteMutate = vi.fn();
const addMutate = vi.fn();

vi.mock("../hooks/api/useHouseholds", async (orig) => {
  const real = await orig<typeof import("../hooks/api/useHouseholds")>();
  const idle = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...real,
    useHousehold: vi.fn(),
    useHouseholdProgress: vi.fn(),
    useRemoveHouseholdItem: idle,
    useRenameHousehold: idle,
    useDeleteHousehold: idle,
    useRemoveHouseholdMember: idle,
    useInviteToHousehold: () => ({ mutate: inviteMutate, isPending: false }),
    useAddHouseholdItem: () => ({ mutate: addMutate, isPending: false }),
    useHouseholdInvitable: vi.fn(),
    useHouseholdRecommendations: vi.fn(),
    useCancelHouseholdInvite: idle,
  };
});
vi.mock("../hooks/useAuthUser", () => ({ useAuthUser: () => ({ uid: "u1" }) }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../components/WatchedTogetherModal", () => ({
  default: ({ target, householdId }: { target: unknown; householdId: number }) => (
    <div data-testid="modal">{JSON.stringify({ target, householdId })}</div>
  ),
}));

const household: HouseholdDetail = {
  id: 3,
  name: "Our place",
  role: "owner",
  max_members: 6,
  members: [
    { user_id: "u1", username: "me", display_name: null, avatar_key: null, role: "owner" },
    { user_id: "u2", username: "sam", display_name: null, avatar_key: null, role: "member" },
  ],
  invites: [],
  items: [],
  services: [],
};

const next = { season_number: 2, episode_number: 4, name: "The Reveal", air_date: "2026-01-01" };
const progress: HouseholdProgress = {
  shows: [
    {
      id: 9,
      title: "Severance",
      poster_path: null,
      year: 2022,
      total_aired: 20,
      together_next: next,
      members: [
        { user_id: "u1", last_watched: { season_number: 2, episode_number: 5 }, watched_count: 15, next: null, ahead_by: 2 },
        { user_id: "u2", last_watched: null, watched_count: 0, next, ahead_by: 0 },
      ],
    },
  ],
};

function renderPage(path = "/households/3?tab=progress") {
  vi.mocked(useHousehold).mockReturnValue({ data: household, isPending: false, error: null, refetch: vi.fn() } as never);
  vi.mocked(useHouseholdProgress).mockReturnValue({ data: progress, isPending: false, error: null, refetch: vi.fn() } as never);
  vi.mocked(useHouseholdInvitable).mockReturnValue({
    data: [
      { user_id: "u3", username: "jordan", display_name: "Jordan", avatar_key: null, invited: false },
      { user_id: "u4", username: "riley", display_name: null, avatar_key: null, invited: true },
    ],
    isPending: false,
    isError: false,
  } as never);
  vi.mocked(useHouseholdRecommendations).mockReturnValue({
    data: {
      shows: [{
        id: 77, media_type: "tv", name: "Dark", poster_path: "/d.jpg", vote_average: 8,
        because: [{ id: 9, content_type: "tv", title: "Severance", reason: "watched" }],
      }],
      movies: [],
      shared_count: 1,
    },
    isPending: false,
    isError: false,
  } as never);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/households/:id" element={<HouseholdPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HouseholdPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("progress tab shows the next episode together and who is ahead", () => {
    renderPage();
    const card = screen.getByRole("article", { name: "Severance" });
    expect(within(card).getByText("Next together: S2 E4 · The Reveal")).toBeInTheDocument();
    expect(within(card).getByText("On S2 E5")).toBeInTheDocument();
    expect(within(card).getByText("Not started")).toBeInTheDocument();
    expect(within(card).getByText("+2 ahead")).toBeInTheDocument();
    expect(within(card).getByText("You")).toBeInTheDocument();
  });

  it("opens the who-watched dialog for the next episode", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "We watched it" }));
    const body = JSON.parse(screen.getByTestId("modal").textContent ?? "{}");
    expect(body.householdId).toBe(3);
    expect(body.target).toMatchObject({ contentType: "tv", contentId: 9, seasonNumber: 2, episodeNumber: 4 });
  });

  it("starts on the shared list and shows owner controls", () => {
    renderPage("/households/3");
    expect(screen.getByRole("button", { name: "Delete household" })).toBeInTheDocument();
    expect(screen.getByText("Nothing on the list yet")).toBeInTheDocument();
  });

  it("shows picks from what you share, and + adds one to the list", () => {
    renderPage("/households/3?tab=together");
    expect(screen.getByText("Because you both watched Severance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Dark to the Watch together list" }));
    expect(addMutate.mock.calls[0][0]).toEqual({ householdId: 3, contentType: "tv", contentId: 77 });
  });

  it("suggests friends as you type, and invites from the friends list", () => {
    renderPage("/households/3?tab=members");
    const search = screen.getByRole("combobox", { name: "Search your friends" });
    fireEvent.change(search, { target: { value: "jor" } });
    const option = within(screen.getByRole("listbox")).getByRole("option", { name: /Jordan/ });
    fireEvent.click(option);
    expect(inviteMutate.mock.calls[0][0]).toEqual({ householdId: 3, username: "jordan" });

    // Already invited: no + button, just a label.
    expect(screen.queryByRole("button", { name: "Invite riley" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite Jordan" }));
    expect(inviteMutate.mock.calls[1][0]).toEqual({ householdId: 3, username: "jordan" });
  });
});
