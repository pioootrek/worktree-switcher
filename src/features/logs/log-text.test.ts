import { describe, expect, it } from "vitest";
import { cleanLogText, logMatches } from "./log-text";

describe("log text", () => {
  it("removes terminal color, cursor and hyperlink controls while retaining readable text", () => {
    expect(cleanLogText("\u001b[31mError\u001b[0m\n\tat file.ts:3\u001b[2K")).toBe("Error\n\tat file.ts:3");
    expect(cleanLogText("\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(cleanLogText("\u001b]8;;https://example.test\u001b\\link\u001b]8;;\u001b\\")).toBe("link");
    expect(cleanLogText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
  it("finds literal case-insensitive occurrences and bounds search work", () => {
    expect(logMatches(["error ERROR", "[a].*"], "error").matches).toEqual([{ line: 0, start: 0, end: 5 }, { line: 0, start: 6, end: 11 }]);
    expect(logMatches(["[a].*"], "[a].*").matches).toHaveLength(1);
    expect(logMatches(["aaaa"], "a", 2)).toEqual({ matches: [{ line: 0, start: 0, end: 1 }, { line: 0, start: 1, end: 2 }], truncated: true });
    expect(logMatches(["abc"], "").matches).toEqual([]);
  });
});
