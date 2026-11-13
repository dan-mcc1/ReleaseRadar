import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdTonight from "./HouseholdTonight";
import {
  useHouseholdPicks,
  type HouseholdDetail,
  type PickReasonItem,
  type TonightPick,
} from "../hooks/api/useHouseholds";

const addMutate = vi.fn();

vi.mock("../hooks/api/useHouseholds", async (orig) => {
  const real = await orig<typeof import("../hooks/api/useHouseholds")>();
  return {
    ...real,
    useHouseholdPicks: vi.fn(),
    useAddHouseholdItem: () => ({ mutate: addMutate, isPending: false }),
  };
});
vi.mock("../hooks/useAuthUser", () => ({ useAuthUser: () => ({ uid: "u1" }) }));
vi.mock("./Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("./WatchedTogetherModal", () => ({
  default: ({ target, householdId, presentUserIds }: { target: unknown; householdId: number; presentUserIds: string[] }) => (
    <div data-testid="modal">{JSON.stringify({ target, householdId, presentUserIds })}</div>
  ),
}));

const household: HouseholdDetail = {
  id: 3,
  name: "Our place",
  role: "owner",
  max_members: 6,
  members: [
    { user_id: "u1", username: "me", display_name: null, avatar_key: null, role: "owner" },
    { user_id: "u2", username: "sam", display_name: "Sam", avatar_key: null, role: "member" },
    { user_id: "u3", username: "jo", display_name: "Jo", avatar_key: null, role: "member" },
  ],
  invites: [],
  items: [],
  services: [],
};

function pick(id: number, over: Partial<TonightPick> = {}): TonightPick {
  return {
    content_type: "tv",
    id,
    title: `Title ${id}`,
    poster_path: null,
    year: 2020,
    runtime: 30,
    certification: null,
    episode: { season_number: 2, episode_number: 4, name: "The Reveal" },
    services: [],
    reasons: [],
    score: 1,
    ...over,
  };
}

function mockPicks(picks: TonightPick[]) {
  vi.mocked(useHouseholdPicks).mockReturnValue({
    data: { present: ["u1", "u2", "u3"], picks },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  } as never);
}

function renderTonight() {
  return render(
    <MemoryRouter>
      <HouseholdTonight h={household} />
    </MemoryRouter>,
  );
}

function reasonFor(reason: PickReasonItem) {
  mockPicks([pick(1, { reasons: [reason] })]);
  renderTonight();
}

const lastPresent = () => vi.mocked(useHouseholdPicks).mock.lastCall?.[1].present;

describe("HouseholdTonight", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("words a next episode reason for some people and for everyone", () => {
    reasonFor({ type: "next_episode", user_ids: ["u1", "u2"] });
    expect(screen.getByText("Next episode for you and Sam")).toBeInTheDocument();
  });

  it("says all of you when the next episode is for everyone present", () => {
    reasonFor({ type: "next_episode", user_ids: ["u1", "u2", "u3"] });
    expect(screen.getByText("Next episode for all of you")).toBeInTheDocument();
  });

  it("words a shared list reason, crediting someone else but not you", () => {
    reasonFor({ type: "shared_list", user_id: "u2" });
    expect(screen.getByText("On your Watch together list · added by Sam")).toBeInTheDocument();
  });

  it("does not credit you for your own addition", () => {
    reasonFor({ type: "shared_list", user_id: "u1" });
    expect(screen.getByText("On your Watch together list")).toBeInTheDocument();
  });

  it("words want reasons for two people and for three or more", () => {
    reasonFor({ type: "want", user_ids: ["u1", "u2"] });
    expect(screen.getByText("You and Sam both want to watch this")).toBeInTheDocument();
  });

  it("says all of you want it for three or more", () => {
    reasonFor({ type: "want", user_ids: ["u1", "u2", "u3"] });
    expect(screen.getByText("All of you want to watch this")).toBeInTheDocument();
  });

  it("words recommended reasons with and without a source", () => {
    reasonFor({ type: "recommended", because: "Severance" });
    expect(screen.getByText("Because you all watched Severance")).toBeInTheDocument();
  });

  it("falls back to Recommended for you", () => {
    reasonFor({ type: "recommended", because: null });
    expect(screen.getByText("Recommended for you")).toBeInTheDocument();
  });

  it("describes episodes, unstarted shows and movies", () => {
    mockPicks([
      pick(1, { reasons: [{ type: "next_episode", user_ids: ["u1"] }] }),
      pick(2, { episode: { season_number: 1, episode_number: 1, name: null } }),
      pick(3, { content_type: "movie", episode: null, runtime: 105 }),
    ]);
    renderTonight();
    expect(screen.getByText("S2 E4 · The Reveal")).toBeInTheDocument();
    expect(screen.getByText("Start S1 E1")).toBeInTheDocument();
    expect(screen.getByText("Movie")).toBeInTheDocument();
    expect(screen.getByText("· 1h 45m")).toBeInTheDocument();
    expect(screen.getAllByText("· 30 min")).toHaveLength(2);
  });

  it("changes who is watching, and keeps the last person on", () => {
    mockPicks([pick(1)]);
    renderTonight();
    expect(lastPresent()).toEqual(["u1", "u2", "u3"]);

    fireEvent.click(screen.getByRole("button", { name: "Sam" }));
    expect(lastPresent()).toEqual(["u1", "u3"]);

    fireEvent.click(screen.getByRole("button", { name: "Jo" }));
    expect(lastPresent()).toEqual(["u1"]);

    const you = screen.getByRole("button", { name: "You" });
    expect(you).toBeDisabled();
    fireEvent.click(you);
    expect(lastPresent()).toEqual(["u1"]);
  });

  it("passes the filters to the hook", () => {
    mockPicks([pick(1)]);
    renderTonight();
    fireEvent.click(screen.getByRole("button", { name: "~1 hour" }));
    fireEvent.click(screen.getByRole("button", { name: "On our services" }));
    fireEvent.click(screen.getByRole("button", { name: "Kid-friendly" }));
    expect(vi.mocked(useHouseholdPicks).mock.lastCall?.[1]).toMatchObject({
      time: "hour",
      services: true,
      kids: true,
    });
  });

  it("surprise me shows one pick and spin again changes it", () => {
    mockPicks([pick(1), pick(2), pick(3)]);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    renderTonight();
    fireEvent.click(screen.getByRole("button", { name: "Surprise me" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Title 1" })).toBeInTheDocument();

    // random 0 would pick Title 1 again; it must skip the one just shown.
    fireEvent.click(screen.getByRole("button", { name: "Spin again" }));
    expect(screen.getByRole("article", { name: "Title 2" })).toBeInTheDocument();
    expect(random).toHaveBeenCalled();
  });

  it("We watched it opens the dialog for the episode with the people present", () => {
    mockPicks([pick(9, { title: "Severance" })]);
    renderTonight();
    fireEvent.click(screen.getByRole("button", { name: "Jo" }));
    fireEvent.click(screen.getByRole("button", { name: "We watched it" }));
    const body = JSON.parse(screen.getByTestId("modal").textContent ?? "{}");
    expect(body.householdId).toBe(3);
    expect(body.presentUserIds).toEqual(["u1", "u2"]);
    expect(body.target).toMatchObject({
      contentType: "tv",
      contentId: 9,
      seasonNumber: 2,
      episodeNumber: 4,
      label: "Severance S2 E4",
    });
  });

  it("+ adds a recommended pick to the list", () => {
    mockPicks([pick(5, { reasons: [{ type: "recommended", because: null }] })]);
    renderTonight();
    fireEvent.click(screen.getByRole("button", { name: "Add Title 5 to the Watch together list" }));
    expect(addMutate.mock.calls[0][0]).toEqual({ householdId: 3, contentType: "tv", contentId: 5 });
  });

  it("explains an empty result and suggests loosening filters", () => {
    mockPicks([]);
    renderTonight();
    expect(screen.getByText(/shows you are watching together\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kid-friendly" }));
    expect(screen.getByText(/Try loosening the filters/)).toBeInTheDocument();
  });

  it("words a recommendation that comes from your lists", () => {
    reasonFor({ type: "recommended", because: "Dune", basis: "lists" });
    expect(screen.getByText("Because Dune is on your lists")).toBeInTheDocument();
  });

  it("logs a movie pick too", () => {
    mockPicks([pick(7, { content_type: "movie", title: "Arrival", episode: null, runtime: 116 })]);
    renderTonight();
    fireEvent.click(screen.getByRole("button", { name: "We watched it" }));
    const shown = JSON.parse(screen.getByTestId("modal").textContent ?? "{}");
    expect(shown.target).toEqual({ contentType: "movie", contentId: 7, label: "Arrival" });
  });

  it("can't log or add while picks for new people are loading", () => {
    vi.mocked(useHouseholdPicks).mockReturnValue({
      data: {
        present: ["u1", "u2", "u3"],
        picks: [pick(1, { reasons: [{ type: "recommended", because: null }] })],
      },
      isPending: false,
      isPlaceholderData: true,
      error: null,
      refetch: vi.fn(),
    } as never);
    renderTonight();
    expect(screen.getByRole("button", { name: "We watched it" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Add Title 1/ })).toBeDisabled();
  });
});

