import { describe, expect, it } from "vitest";

import { parseWorktreePorcelain } from "./git-worktrees";

describe("parseWorktreePorcelain", () => {
  it("parses branches, detached worktrees, and flags from nul-delimited output", () => {
    const output = [
      "worktree /code/app",
      "HEAD 0123456789abcdef",
      "branch refs/heads/main",
      "",
      "worktree /code/app-feature",
      "HEAD fedcba9876543210",
      "detached",
      "locked maintenance",
      "",
    ].join("\0");

    expect(parseWorktreePorcelain(output)).toEqual([
      {
        path: "/code/app",
        head: "0123456789abcdef",
        shortHead: "01234567",
        branch: "main",
        detached: false,
        locked: false,
        prunable: false,
      },
      {
        path: "/code/app-feature",
        head: "fedcba9876543210",
        shortHead: "fedcba98",
        branch: null,
        detached: true,
        locked: true,
        prunable: false,
      },
    ]);
  });
});
