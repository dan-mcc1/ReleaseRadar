import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdSwipe from "./HouseholdSwipe";
import {
  useHouseholdSession,
  type Candidate,
  type HouseholdDetail,
  type SwipeSession,
} from "../hooks/api/useHouseholds";

const swipeMutate = vi.fn();
const pickMutate = vi.fn();
const startMutate = vi.fn();
const endMutate = vi.fn();

vi.mock("../hooks/api/useHouseholds", async (orig) => {
  const real = await orig<typeof import("../hooks/api/useHouseholds")>();
  return {
    ...real,
    useHouseholdSession: vi.fn(),
    useSwipe: () => ({ mutate: swipeMutate, isPending: false }),
    usePickFromSession: () => ({ mutate: pickMutate, isPending: false }),
    useStartSession: () => ({ mutate: startMutate, isPending: false }),
    useEndSession: () => ({ mutate: endMutate, isPending: false }),
  };
});
vi.mock("./Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("./WatchedTogetherModal", () => ({
  default: ({ presentUserIds }: { presentUserIds: string[] }) => (
    <div data-testid="modal">{presentUserIds.join(",")}</div>
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

const nameOf = (id: string) => (id === "u1" ? "You" : id === "u2" ? "Sam" : "Jo");

function cand(id: number, over: Partial<Candidate> = {}): Candidate {
  return {
    content_type: "movie",
    id,
    title: `Title ${id}`,
    poster_path: null,
    year: 2020,
    runtime: 100,
    certification: null,
    episode: null,
    services: [],
    reasons: [],
    ...over,
  };
}

function session(over: Partial<SwipeSession> = {}): SwipeSession {
  return {
    id: 9,
    household_id: 3,
    created_by: "u1",
    participants: ["u1", "u2"],
    status: "open",
    expires_at: "2030-01-01T00:00:00Z",
    picked: null,
    candidates: [cand(1), cand(2), cand(3)],
    my_votes: {},
    progress: { u1: 0, u2: 0 },
    finished: false,
    results: null,
    matches: [],
    ...over,
  };
}

const result = (id: number, yes: number, of = 2, over: Partial<Candidate> = {}) => ({
  ...cand(id, over),
  yes,
  of,
});

function mockSession(data: SwipeSession | null) {
  vi.mocked(useHouseholdSession).mockReturnValue({
    data,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  } as never);
}

function renderSwipe(present = ["u1", "u2", "u3"]) {
  return render(
    <MemoryRouter>
      <HouseholdSwipe
        h={household}
        present={present}
        time="hour"
        services={false}
        kids
        nameOf={nameOf}
        uid="u1"
      />
    </MemoryRouter>,
  );
}

const body = (vote: boolean, id = 1) => ({
  householdId: 3,
  sessionId: 9,
  contentType: "movie",
  contentId: id,
  vote,
});

describe("HouseholdSwipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swipeMutate.mockReset();
  });

  it("shows the first title you have not voted on, with progress", () => {
    mockSession(session({ my_votes: { "movie:1": true }, progress: { u1: 1, u2: 8 } }));
    renderSwipe();
    expect(screen.getByRole("article", { name: "Title 2" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 swiped")).toBeInTheDocument();
    expect(screen.getByText("Sam 8/3")).toBeInTheDocument();
  });

  it("Yes and No send the vote for the card on screen", () => {
    mockSession(session());
    renderSwipe();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(swipeMutate.mock.calls[0][0]).toEqual(body(true));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(swipeMutate.mock.calls[1][0]).toEqual(body(false));
  });

  it("arrow keys vote: right is yes, left is no", () => {
    mockSession(session());
    renderSwipe();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(swipeMutate.mock.calls[0][0]).toEqual(body(true));
    expect(swipeMutate.mock.calls[1][0]).toEqual(body(false));
  });

  it("a drag past the threshold votes and a short one snaps back", () => {
    mockSession(session());
    renderSwipe();
    const card = screen.getByRole("article", { name: "Title 1" });
    fireEvent.pointerDown(card, { clientX: 200, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(card, { clientX: 260, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(card, { clientX: 260, pointerId: 1, isPrimary: true });
    expect(swipeMutate).not.toHaveBeenCalled();

    fireEvent.pointerDown(card, { clientX: 200, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(card, { clientX: 80, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(card, { clientX: 80, pointerId: 1, isPrimary: true });
    expect(swipeMutate.mock.calls[0][0]).toEqual(body(false));
  });

  it("Undo brings the last swipe back so it can be changed", () => {
    const s = session();
    mockSession(s);
    const { rerender } = renderSwipe();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    mockSession({ ...s, my_votes: { "movie:1": true }, progress: { u1: 1, u2: 0 } });
    rerender(
      <MemoryRouter>
        <HouseholdSwipe h={household} present={["u1", "u2"]} time="any" services={false} kids={false} nameOf={nameOf} uid="u1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("article", { name: "Title 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("article", { name: "Title 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(swipeMutate.mock.calls[1][0]).toEqual(body(false));
  });

  it("never pops up a match mid-round", () => {
    mockSession(session());
    swipeMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.(session()));
    renderSwipe();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/match/i)).not.toBeInTheDocument();
  });

  it("when everyone's done: what you all agreed on, then the partial yeses", () => {
    const yes3 = result(1, 3, 3, { title: "Arrival" });
    mockSession(
      session({
        participants: ["u1", "u2", "u3"],
        finished: true,
        matches: [yes3],
        results: [yes3, result(2, 2, 3, { title: "Dune" }), result(3, 1, 3, { title: "Heat" })],
      }),
    );
    renderSwipe();
    expect(screen.getByRole("heading", { name: "Everyone agreed on" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2 of 3 of you said yes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 of 3 of you said yes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Watch this" })[1]); // Dune
    expect(pickMutate.mock.calls[0][0]).toEqual({ householdId: 3, sessionId: 9, contentType: "movie", contentId: 2 });
  });

  it("Pick one for us chooses at random from what everyone agreed on", () => {
    const a = result(1, 2, 2, { title: "Arrival" });
    const b = result(2, 2, 2, { title: "Dune" });
    mockSession(session({ finished: true, matches: [a, b], results: [a, b] }));
    const random = vi.spyOn(Math, "random").mockReturnValue(0.75);
    renderSwipe();
    fireEvent.click(screen.getByRole("button", { name: "Pick one for us" }));
    expect(pickMutate.mock.calls[0][0]).toMatchObject({ contentId: 2 });
    random.mockRestore();
  });

  it("with no full agreement, Pick one for us uses the closest tier", () => {
    mockSession(
      session({
        participants: ["u1", "u2", "u3"],
        finished: true,
        matches: [],
        results: [result(2, 2, 3, { title: "Dune" }), result(3, 1, 3, { title: "Heat" })],
      }),
    );
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    renderSwipe();
    expect(screen.getByRole("heading", { name: "Nobody agreed on everything" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick one for us" }));
    expect(pickMutate.mock.calls[0][0]).toMatchObject({ contentId: 2 });
    random.mockRestore();
  });

  it("no yeses at all offers a new round", () => {
    mockSession(session({ finished: true, matches: [], results: [] }));
    renderSwipe();
    expect(screen.getByText("No yeses this round")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a new round" })).toBeInTheDocument();
  });

  it("waits for the others once everything is swiped", () => {
    mockSession(
      session({
        my_votes: { "movie:1": true, "movie:2": false, "movie:3": true },
        progress: { u1: 3, u2: 1 },
      }),
    );
    renderSwipe();
    expect(screen.getByText("Waiting for the others")).toBeInTheDocument();
    expect(screen.getByText("Sam 1/3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
  });

  it("shows who is swiping when you are not part of it, and can end it", () => {
    mockSession(session({ participants: ["u2", "u3"], progress: { u2: 4, u3: 2 } }));
    renderSwipe();
    expect(screen.getByText("Sam and Jo are swiping")).toBeInTheDocument();
    expect(screen.getByText("Sam 4/3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(endMutate.mock.calls[0][0]).toEqual({ householdId: 3, sessionId: 9 });
  });

  it("a picked session offers We watched it for everyone in it, and a new round", () => {
    mockSession(session({ status: "picked", picked: { content_type: "movie", id: 2 } }));
    renderSwipe(["u1", "u2"]);
    expect(screen.getByRole("article", { name: "Title 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "We watched it" }));
    expect(screen.getByTestId("modal")).toHaveTextContent("u1,u2");
    fireEvent.click(screen.getByRole("button", { name: "Start a new round" }));
    expect(startMutate.mock.calls[0][0]).toEqual({
      householdId: 3,
      present: ["u1", "u2"],
      time: "hour",
      services: false,
      kids: true,
      size: 10,
    });
  });

  it("Start swiping sends the people, filters and round size", () => {
    mockSession(null);
    renderSwipe();
    fireEvent.click(screen.getByRole("button", { name: "5 cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Start swiping" }));
    expect(startMutate.mock.calls[0][0]).toMatchObject({ householdId: 3, present: ["u1", "u2", "u3"], size: 5 });
  });

  it("Start swiping is off with fewer than two people", () => {
    mockSession(null);
    renderSwipe(["u1"]);
    expect(screen.getByRole("button", { name: "Start swiping" })).toBeDisabled();
    expect(screen.getByText("Pick at least two people, including you.")).toBeInTheDocument();
  });

  it("a held arrow key is one swipe", () => {
    mockSession(session());
    renderSwipe();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(swipeMutate).toHaveBeenCalledTimes(1);
  });

  it("a right-click or a second finger doesn't drag", () => {
    mockSession(session());
    renderSwipe();
    const card = screen.getByRole("article", { name: "Title 1" });
    fireEvent.pointerDown(card, { clientX: 200, pointerId: 1, isPrimary: true, button: 2 });
    fireEvent.pointerUp(card, { clientX: 20, pointerId: 1, isPrimary: true, button: 2 });
    fireEvent.pointerDown(card, { clientX: 200, pointerId: 2, isPrimary: false });
    fireEvent.pointerUp(card, { clientX: 20, pointerId: 2, isPrimary: false });
    expect(swipeMutate).not.toHaveBeenCalled();
  });
});

