import { describe, expect, it } from "vitest";
import { parseLocalDate, toLocalISODate } from "./date";

describe("date helpers", () => {
  it("parses YYYY-MM-DD as a local date, not UTC", () => {
    const d = parseLocalDate("2026-03-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 5]);
  });

  it("round-trips through toLocalISODate with zero padding", () => {
    expect(toLocalISODate(parseLocalDate("2026-01-09"))).toBe("2026-01-09");
    expect(toLocalISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
