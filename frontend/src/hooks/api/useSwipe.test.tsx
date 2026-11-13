import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./queryKeys";
import { swipeInFlight, useSwipe, type SwipeSession } from "./useHouseholds";
import { apiFetch } from "../../utils/apiFetch";

vi.mock("../../utils/apiFetch", () => ({ apiFetch: vi.fn() }));
vi.mock("../useAuthUser", () => ({ useAuthUser: () => ({ uid: "u1" }) }));

const KEY = queryKeys.householdSession("u1", 3);

function session(my_votes: Record<string, boolean> = {}): SwipeSession {
  return {
    id: 9, household_id: 3, created_by: "u1", participants: ["u1", "u2"], status: "open",
    expires_at: "2099-01-01T00:00:00Z", picked: null, candidates: [], my_votes,
    progress: { u1: Object.keys(my_votes).length, u2: 0 }, finished: false, results: null, matches: [],
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(KEY, session());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSwipe(), { wrapper });
  return { qc, result };
}

/** A vote request that resolves when the test says so. */
function deferredVotes() {
  const pending: ((ok: boolean) => void)[] = [];
  vi.mocked(apiFetch).mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        pending.push((ok) =>
          resolve(new Response(JSON.stringify(ok ? session() : { detail: "nope" }), {
            status: ok ? 200 : 409,
          })),
        );
      }),
  );
  return pending;
}

const vote = (contentId: number, yes = true) => ({
  householdId: 3, sessionId: 9, contentType: "movie" as const, contentId, vote: yes,
});

describe("useSwipe: fast swipes don't bring a card back", () => {
  beforeEach(() => vi.clearAllMocks());

  it("waits for the last swipe before refreshing, and says so", async () => {
    const pending = deferredVotes();
    const { qc, result } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    act(() => {
      result.current.mutate(vote(1));
      result.current.mutate(vote(2));
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(swipeInFlight()).toBe(true);
    expect(qc.getQueryData<SwipeSession>(KEY)?.my_votes).toEqual({ "movie:1": true, "movie:2": true });

    // The first swipe finishes while the second is still saving: no refresh
    // yet, since it could read the server before vote 2 is saved.
    await act(async () => pending[0](true));
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryData<SwipeSession>(KEY)?.my_votes).toEqual({ "movie:1": true, "movie:2": true });

    // The last one refreshes, once.
    await act(async () => pending[1](true));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(swipeInFlight()).toBe(false);
  });

  it("a failed swipe undoes only its own vote", async () => {
    const pending = deferredVotes();
    const { qc, result } = setup();

    act(() => {
      result.current.mutate(vote(1));
      result.current.mutate(vote(2));
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[0](false)); // vote 1 fails
    expect(qc.getQueryData<SwipeSession>(KEY)?.my_votes).toEqual({ "movie:2": true });
    await act(async () => pending[1](true));
  });
});
