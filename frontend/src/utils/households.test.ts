import { describe, expect, it } from "vitest";
import { filterPicks } from "./households";

const show = (runtime: number | null, certification: string | null = null, services: unknown[] = []) => ({
  content_type: "tv" as const, runtime, certification, services,
});
const movie = (certification: string | null = null, services: unknown[] = []) => ({
  content_type: "movie" as const, runtime: 110, certification, services,
});
const none = { time: "any" as const, services: false, kids: false };

describe("filterPicks (same rules as the server)", () => {
  it("keeps everything with no filters", () => {
    expect(filterPicks([show(30), movie()], none)).toHaveLength(2);
  });

  it("time: episodes by length, unknown runtime passes, movies only for 'movie'", () => {
    const picks = [show(30), show(60), show(null), movie()];
    expect(filterPicks(picks, { ...none, time: "short" })).toEqual([show(30), show(null)]);
    expect(filterPicks(picks, { ...none, time: "hour" })).toEqual([show(30), show(60), show(null)]);
    expect(filterPicks(picks, { ...none, time: "movie" })).toEqual([movie()]);
  });

  it("services: only titles on a service someone watching pays for", () => {
    const netflix = [{ id: 8, name: "Netflix" }];
    expect(filterPicks([show(30, null, netflix), show(30)], { ...none, services: true })).toEqual([
      show(30, null, netflix),
    ]);
  });

  it("kid-friendly: by rating, and an unknown rating never passes", () => {
    const picks = [movie("PG"), movie("R"), movie(null), show(30, "TV-Y7")];
    expect(filterPicks(picks, { ...none, kids: true })).toEqual([movie("PG"), show(30, "TV-Y7")]);
  });
});
