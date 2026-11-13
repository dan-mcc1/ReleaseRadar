import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WatchedTogetherModal, { type LogTarget } from "./WatchedTogetherModal";
import { apiFetch } from "../utils/apiFetch";

vi.mock("../utils/apiFetch", () => ({ apiFetch: vi.fn() }));
vi.mock("../hooks/useAuthUser", () => ({ useAuthUser: () => ({ uid: "u1" }) }));
vi.mock("../hooks/api/useHouseholds", async (orig) => ({
  ...(await orig<typeof import("../hooks/api/useHouseholds")>()),
  useHouseholds: () => ({
    data: {
      invites: [],
      households: [
        {
          id: 3,
          name: "Our place",
          role: "owner",
          item_count: 0,
          members: [
            { user_id: "u1", username: "me", display_name: null, avatar_key: null, role: "owner" },
            { user_id: "u2", username: "sam", display_name: null, avatar_key: null, role: "member" },
            { user_id: "u3", username: "kit", display_name: "Kit", avatar_key: null, role: "member" },
          ],
        },
      ],
    },
  }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => toast }));

function renderModal(target: LogTarget) {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <WatchedTogetherModal open onClose={onClose} target={target} />
    </QueryClientProvider>,
  );
  return onClose;
}

function lastCall() {
  const [path, init] = vi.mocked(apiFetch).mock.calls.at(-1)!;
  return { path, method: init?.method, body: JSON.parse(String(init?.body)) };
}

describe("WatchedTogetherModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockImplementation(async () =>
      new Response(JSON.stringify({ logged: ["u1", "u2", "u3"] }), { status: 200 }),
    );
  });

  it("labels the current user and checks everyone by default", () => {
    renderModal({ contentType: "movie", contentId: 5 });
    expect(screen.getByRole("checkbox", { name: "You" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "sam" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Kit" })).toBeChecked();
  });

  it("logs an episode for the checked members only", async () => {
    const onClose = renderModal({ contentType: "tv", contentId: 9, seasonNumber: 2, episodeNumber: 4 });
    fireEvent.click(screen.getByRole("checkbox", { name: "sam" }));
    fireEvent.click(screen.getByRole("button", { name: "Log watch" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastCall()).toEqual({
      path: "/households/3/log",
      method: "POST",
      body: { user_ids: ["u1", "u3"], content_type: "tv", content_id: 9, season_number: 2, episode_number: 4 },
    });
    expect(toast.success).toHaveBeenCalledWith("Logged for 3 people");
  });

  it("logs a season without an episode number", async () => {
    const onClose = renderModal({ contentType: "tv", contentId: 9, seasonNumber: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Log watch" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastCall().body).toEqual({
      user_ids: ["u1", "u2", "u3"],
      content_type: "tv",
      content_id: 9,
      season_number: 2,
    });
  });

  it("logs a movie without season or episode", async () => {
    const onClose = renderModal({ contentType: "movie", contentId: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Log watch" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lastCall().body).toEqual({
      user_ids: ["u1", "u2", "u3"],
      content_type: "movie",
      content_id: 5,
    });
  });
});
