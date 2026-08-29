import { describe, expect, it } from "vitest";

import { browserCommand } from "./browser";

describe("browserCommand", () => {
  it("skips automatic browser launch on a headless Linux host", () => {
    expect(browserCommand("http://localhost", "linux", {})).toBeNull();
  });

  it("uses xdg-open when a Linux graphical session exists", () => {
    expect(browserCommand("http://localhost", "linux", { DISPLAY: ":0" })).toEqual({
      command: "xdg-open",
      args: ["http://localhost"],
    });
  });
});
