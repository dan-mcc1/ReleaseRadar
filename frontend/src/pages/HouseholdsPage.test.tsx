import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HouseholdsPage from "./HouseholdsPage";
import {
  useAcceptHouseholdInvite,
  useCreateHousehold,
  useDeclineHouseholdInvite,
  useHouseholds,
  type HouseholdsResponse,
} from "../hooks/api/useHouseholds";

vi.mock("../hooks/api/useHouseholds", async (orig) => ({
  ...(await orig<typeof import("../hooks/api/useHouseholds")>()),
  useHouseholds: vi.fn(),
  useAcceptHouseholdInvite: vi.fn(),
  useDeclineHouseholdInvite: vi.fn(),
  useCreateHousehold: vi.fn(),
}));
vi.mock("../components/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const accept = vi.fn();
const decline = vi.fn();

function renderWith(data: HouseholdsResponse) {
  vi.mocked(useHouseholds).mockReturnValue({ data, isPending: false, error: null, refetch: vi.fn() } as never);
  return render(
    <MemoryRouter>
      <HouseholdsPage />
    </MemoryRouter>,
  );
}

const invite = {
  id: 7,
  household: { id: 3, name: "Our place", member_count: 2 },
  invited_by: { user_id: "u2", username: "sam", display_name: null, avatar_key: null },
  created_at: "2026-11-01T00:00:00Z",
};

describe("HouseholdsPage", () => {
  beforeEach(() => {
    accept.mockReset();
    decline.mockReset();
    vi.mocked(useAcceptHouseholdInvite).mockReturnValue({ mutate: accept, isPending: false } as never);
    vi.mocked(useDeclineHouseholdInvite).mockReturnValue({ mutate: decline, isPending: false } as never);
    vi.mocked(useCreateHousehold).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
  });

  it("shows the consent text and accepts or declines the invite", () => {
    renderWith({ households: [], invites: [invite] });
    expect(screen.getByText("sam invited you · 2 members")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Joining lets members see your lists and progress on shared titles, and log watches for you.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept.mock.calls[0][0]).toBe(7);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(decline.mock.calls[0][0]).toBe(7);
  });

  it("lists each household with a link and its item count", () => {
    renderWith({
      households: [
        {
          id: 3,
          name: "Our place",
          role: "owner",
          item_count: 4,
          members: [{ user_id: "u1", username: "me", display_name: "Me", avatar_key: null, role: "owner" }],
        },
      ],
      invites: [],
    });
    expect(screen.getByText("4 on your list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Our place/ })).toHaveAttribute("href", "/households/3");
  });

  it("leads with the pitch and a create form when there are none", () => {
    renderWith({ households: [], invites: [] });
    expect(screen.getByText("Watch together")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create household" })).toBeInTheDocument();
  });
});
