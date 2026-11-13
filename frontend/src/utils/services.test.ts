import { describe, expect, it } from "vitest";
import type { ServiceOverview, ServiceRelease } from "../hooks/api/useStreamingServices";
import { agoLabel, daysUntil, releaseLabel, verdictLine, whenLabel } from "./services";

const release = (over: Partial<ServiceRelease> = {}): ServiceRelease => ({
  content_type: "tv",
  id: 1,
  title: "The Bear",
  poster_path: null,
  date: "2027-06-05",
  kind: "season_premiere",
  season_number: 4,
  episode_number: 1,
  ...over,
});

const service = (over: Partial<ServiceOverview> = {}): ServiceOverview => ({
  id: 15,
  name: "Hulu",
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
});

describe("releaseLabel", () => {
  it("names each kind of release", () => {
    expect(releaseLabel(release())).toBe("Season 4 premiere");
    expect(releaseLabel(release({ kind: "series_premiere", season_number: 1 }))).toBe("Series premiere");
    expect(releaseLabel(release({ kind: "episode", season_number: 2, episode_number: 5 }))).toBe(
      "New episode · S2 E5",
    );
    expect(releaseLabel(release({ kind: "movie", content_type: "movie" }))).toBe("Movie");
  });
});

describe("whenLabel / daysUntil", () => {
  const today = "2026-11-12";
  it("counts whole days in local time", () => {
    expect(daysUntil("2026-11-18", today)).toBe(6);
  });
  it("says today, tomorrow, in N days, then the date", () => {
    expect(whenLabel("2026-11-12", today)).toBe("Today");
    expect(whenLabel("2026-11-13", today)).toBe("Tomorrow");
    expect(whenLabel("2026-11-18", today)).toBe("In 6 days");
    expect(whenLabel("2027-01-05", today)).toBe("Jan 5, 2027");
  });
});

describe("agoLabel", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  it("reads naturally", () => {
    expect(agoLabel("2026-11-12T10:00:00Z", now)).toBe("today");
    expect(agoLabel("2026-11-11T10:00:00Z", now)).toBe("yesterday");
    expect(agoLabel("2026-11-07T10:00:00Z", now)).toBe("5 days ago");
    expect(agoLabel("2026-10-15T10:00:00Z", now)).toBe("4 weeks ago");
  });
});

describe("verdictLine", () => {
  const now = new Date("2026-11-12T15:00:00Z");

  it("counts what's coming on a service worth keeping", () => {
    expect(verdictLine(service({ upcoming_count: 3 }), 90, 30, now)).toBe(
      "3 titles from your list in the next 3 months.",
    );
  });

  it("explains a keep that rests on recent use", () => {
    const s = service({ last_used: { at: "2026-11-07T10:00:00Z", content_type: "tv", id: 2, title: "Shōgun" } });
    expect(verdictLine(s, 90, 30, now)).toBe(
      "Nothing new from your list in the next 3 months, but you used it 5 days ago.",
    );
  });

  it("suggests pausing and names the next thing", () => {
    expect(verdictLine(service({ verdict: "pause", next_release: release() }), 90, 30, now)).toBe(
      "Nothing from your list in the next 3 months, and you haven't used it in 30 days. Next up: The Bear on Jun 5, 2027.",
    );
    expect(verdictLine(service({ verdict: "pause" }), 90, 30, now)).toMatch(/Nothing on your list is announced/);
  });

  it("promises a reminder only for premieres and movies", () => {
    const paused = { verdict: "paused" as const, paused_at: "2026-11-01T12:00:00Z" };
    expect(verdictLine(service({ ...paused, next_premiere: release() }), 90, 30, now)).toBe(
      "Paused since Nov 1, 2026. We'll remind you a week before The Bear (Jun 5, 2027).",
    );
    expect(
      // A weekly episode is next, and no premiere is known.
      verdictLine(service({ ...paused, next_release: release({ kind: "episode", episode_number: 4 }) }), 90, 30, now),
    ).toBe("Paused since Nov 1, 2026. We'll remind you a week before something from your list premieres here.");
  });
});
