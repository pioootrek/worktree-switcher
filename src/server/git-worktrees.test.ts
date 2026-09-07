import { describe, expect, it } from "vitest";

import { GitCommandAdmission, parseWorktreePorcelain } from "./git-worktrees";

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

describe("GitCommandAdmission", () => {
  it("bounds execution and admits operational validation before queued display work", async () => {
    const admission = new GitCommandAdmission(1, 1);
    const order: string[] = [];
    let release!: () => void;
    const first = admission.run("background", async () => {
      order.push("background-running");
      await new Promise<void>((resolve) => { release = resolve; });
      return "first";
    });
    const second = admission.run("background", async () => { order.push("background-queued"); return "second"; });
    const operational = admission.run("operational", async () => { order.push("operational"); return "operational"; });
    release();
    await expect(first).resolves.toBe("first");
    await expect(operational).resolves.toBe("operational");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["background-running", "operational", "background-queued"]);
    admission.close();
  });

  it("rejects excess queued work and aborts an owned command on close", async () => {
    const admission = new GitCommandAdmission(1, 1);
    const running = admission.run("background", (signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const queued = admission.run("background", async () => undefined);
    await expect(admission.run("background", async () => undefined)).rejects.toThrow("Kolejka poleceń Git");
    admission.close();
    await expect(running).rejects.toThrow("aborted");
    await expect(queued).rejects.toThrow("zamknięta");
  });
});
