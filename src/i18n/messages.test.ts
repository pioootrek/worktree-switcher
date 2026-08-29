import { describe, expect, it } from "vitest";

import { dashboardSummary, localeFrom, systemLocale, translate } from "./messages";

describe("i18n messages", () => {
  it("detects Polish and English browser locales", () => {
    expect(localeFrom("en-US,en;q=0.9")).toBe("en");
    expect(localeFrom("pl-PL")).toBe("pl");
    expect(localeFrom("de-DE")).toBe("en");
    expect(localeFrom(undefined)).toBe("en");
  });

  it("interpolates values in both languages", () => {
    expect(translate("pl", "project.lockedBy", { owner: "Piotr" })).toBe("Zablokowany przez Piotr");
    expect(translate("en", "project.lockedBy", { owner: "Piotr" })).toBe("Locked by Piotr");
  });

  it("uses natural project count forms", () => {
    expect(dashboardSummary("pl", 1, 1)).toBe("1 aktywny · 1 projekt");
    expect(dashboardSummary("pl", 2, 3)).toBe("2 aktywne · 3 projekty");
    expect(dashboardSummary("pl", 0, 12)).toBe("0 aktywnych · 12 projektów");
    expect(dashboardSummary("en", 1, 1)).toBe("1 active · 1 project");
    expect(dashboardSummary("en", 2, 2)).toBe("2 active · 2 projects");
  });

  it("detects the CLI locale from an injected environment", () => {
    expect(systemLocale({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(systemLocale({ LC_ALL: "pl_PL.UTF-8", LANG: "en_US.UTF-8" })).toBe("pl");
    expect(systemLocale({})).toBe("en");
  });
});
