import { describe, expect, it } from "vitest";

import type { Project } from "@/shared/contracts";
import { processExitFailure, spawnFailure } from "./runtime-failure";

const project = { executable: "pnpm", port: 3000 } as Project;

describe("runtime failures", () => {
  it("turns a port collision into an actionable message", () => {
    const failure = processExitFailure(project, ["Error: listen EADDRINUSE 0.0.0.0:3000"], 1, null);
    expect(failure.code).toBe("port_in_use");
    expect(failure.title).toBe("Port 3000 jest już używany");
    expect(failure.suggestion).toContain("systemd");
  });

  it("recognizes a missing dev script", () => {
    const failure = processExitFailure(project, ["ERR_PNPM_NO_SCRIPT Missing script: dev"], 1, null);
    expect(failure.code).toBe("missing_dev_script");
    expect(failure.message).toContain("package.json");
  });

  it("recognizes Django missing from the selected interpreter", () => {
    const failure = processExitFailure(project, ["ModuleNotFoundError: No module named 'django'"], 1, null);
    expect(failure.code).toBe("missing_dependency");
    expect(failure.suggestion).toContain(".venv");
  });

  it("explains a missing executable without exposing ENOENT as the headline", () => {
    const failure = spawnFailure(project, Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }));
    expect(failure.code).toBe("missing_executable");
    expect(failure.title).toBe("Nie znaleziono programu pnpm");
    expect(failure.technicalDetails).toContain("ENOENT");
  });
});
