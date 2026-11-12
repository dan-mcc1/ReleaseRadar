import { describe, expect, it } from "vitest";
import { episodeKind, hasUnwatchedBefore, isUnaired, seasonLabel } from "./episodes";

describe("episodeKind", () => {
  it("calls S1E1 the series premiere and later E1s season premieres", () => {
    expect(episodeKind(1, 1, "standard")).toBe("show_premiere");
    expect(episodeKind(3, 1, "standard")).toBe("season_premiere");
  });

  it("gives specials no tag", () => {
    expect(episodeKind(0, 1, "standard")).toBeNull();
    expect(episodeKind(0, 4, "finale", false, 3)).toBeNull();
  });

  it("only calls the last season's finale of an ended show the series finale", () => {
    expect(episodeKind(3, 10, "finale", false, 3)).toBe("series_finale");
    expect(episodeKind(1, 10, "finale", false, 3)).toBe("season_finale");
    expect(episodeKind(3, 10, "finale", true, 3)).toBe("season_finale");
  });

  it("keeps a type the backend already worked out", () => {
    expect(episodeKind(2, 5, "mid_season")).toBe("mid_season");
    expect(episodeKind(2, 8, "season_finale")).toBe("season_finale");
    expect(episodeKind(2, 3, "standard")).toBeNull();
  });
});

describe("isUnaired", () => {
  const today = "2026-11-12";
  it("is true with no date or a future date", () => {
    expect(isUnaired(null, today)).toBe(true);
    expect(isUnaired("2026-11-13", today)).toBe(true);
  });
  it("is false on or before today", () => {
    expect(isUnaired("2026-11-12", today)).toBe(false);
    expect(isUnaired("2020-01-01", today)).toBe(false);
  });
});

describe("seasonLabel", () => {
  it("names season 0 Specials when TMDb gives no name", () => {
    expect(seasonLabel(0)).toBe("Specials");
    expect(seasonLabel(2)).toBe("Season 2");
    expect(seasonLabel(2, "The Return")).toBe("The Return");
  });
});

describe("hasUnwatchedBefore", () => {
  const today = "2026-11-12";
  const eps = [
    { season_number: 2, episode_number: 1, air_date: "2026-01-01" },
    { season_number: 2, episode_number: 2, air_date: "2026-01-08" },
    { season_number: 2, episode_number: 3, air_date: "2026-01-15" },
  ];
  const watched = (keys: string[]) => (s: number, e: number) => keys.includes(`${s}_${e}`);
  const seasons = [
    { season_number: 0, episode_count: 3 },
    { season_number: 1, episode_count: 2 },
    { season_number: 2, episode_count: 3 },
  ];

  it("is true when an earlier aired episode in the season is unwatched", () => {
    expect(hasUnwatchedBefore(eps[2], eps, watched(["2_2"]), [], new Map(), undefined, today)).toBe(true);
  });

  it("is false for the next episode when everything before is watched", () => {
    const done = new Map([[1, 2]]);
    expect(
      hasUnwatchedBefore(eps[2], eps, watched(["2_1", "2_2"]), seasons, done, undefined, today),
    ).toBe(false);
  });

  it("counts an unfinished earlier season, but never specials", () => {
    expect(
      hasUnwatchedBefore(eps[0], eps, watched([]), seasons, new Map([[1, 1]]), undefined, today),
    ).toBe(true);
    // Season 0 is unwatched but doesn't count.
    expect(
      hasUnwatchedBefore(eps[0], eps, watched([]), seasons, new Map([[1, 2]]), undefined, today),
    ).toBe(false);
  });

  it("trusts the backend's gaps over episode_count for stored seasons", () => {
    // Season 1 lists 2 episodes but one hasn't aired: the count says
    // unfinished, the backend says nothing aired is left.
    const caughtUp = { first_unwatched: {}, stored_seasons: [1] };
    expect(
      hasUnwatchedBefore(eps[0], eps, watched([]), seasons, new Map([[1, 1]]), caughtUp, today),
    ).toBe(false);
    const behind = { first_unwatched: { "1": 2 }, stored_seasons: [1] };
    expect(
      hasUnwatchedBefore(eps[0], eps, watched([]), seasons, new Map([[1, 1]]), behind, today),
    ).toBe(true);
  });

  it("falls back to episode_count for seasons the backend hasn't stored", () => {
    const unstored = { first_unwatched: {}, stored_seasons: [] };
    expect(
      hasUnwatchedBefore(eps[0], eps, watched([]), seasons, new Map([[1, 1]]), unstored, today),
    ).toBe(true);
  });

  it("ignores earlier episodes that haven't aired", () => {
    const withFuture = [
      { season_number: 2, episode_number: 1, air_date: "2027-01-01" },
      eps[1],
    ];
    expect(hasUnwatchedBefore(eps[1], withFuture, watched([]), [], new Map(), undefined, today)).toBe(false);
  });
});
