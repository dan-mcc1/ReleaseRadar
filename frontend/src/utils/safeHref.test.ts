import { describe, expect, it } from "vitest";
import { safeHref } from "./safeHref";

describe("safeHref", () => {
  it("allows http, https and mailto links", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("keeps relative paths and anchors, trimmed", () => {
    expect(safeHref("  /terms ")).toBe("/terms");
    expect(safeHref("#top")).toBe("#top");
  });

  it("falls back to # for empty, unsafe or unparseable input", () => {
    expect(safeHref(null)).toBe("#");
    expect(safeHref("")).toBe("#");
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
  });
});
