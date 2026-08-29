import { describe, expect, it, vi } from "vitest";

import { visibleOutput } from "./output";

describe("visibleOutput", () => {
  it("uses stderr when stdout is captured but stderr is attached to the terminal", () => {
    const stdout = { isTTY: false, write: vi.fn() };
    const stderr = { isTTY: true, write: vi.fn() };
    expect(visibleOutput(stdout, stderr)).toBe(stderr);
  });

  it("keeps stdout for normal terminals and fully redirected processes", () => {
    const terminal = { isTTY: true, write: vi.fn() };
    const stderr = { isTTY: true, write: vi.fn() };
    expect(visibleOutput(terminal, stderr)).toBe(terminal);

    const redirected = { isTTY: false, write: vi.fn() };
    expect(visibleOutput(redirected, { isTTY: false, write: vi.fn() })).toBe(redirected);
  });
});
