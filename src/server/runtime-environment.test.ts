import { describe, expect, it } from "vitest";

import { inheritedRuntimeEnvironment } from "./runtime-environment";

describe("inheritedRuntimeEnvironment", () => {
  it("removes NODE_ENV while preserving PATH and unrelated variables", () => {
    expect(inheritedRuntimeEnvironment({
      NODE_ENV: "production",
      PATH: "/opt/project/bin:/usr/bin",
      SWITCHER_TEST_VALUE: "preserved",
    })).toEqual({
      PATH: "/opt/project/bin:/usr/bin",
      SWITCHER_TEST_VALUE: "preserved",
    });
  });
});
