import { afterEach, describe, expect, it } from "vitest";

import { endpointIdentity, startControllerFixture, type ControllerFixture } from "../support/controller-fixture";

interface Dashboard {
  projects: Array<{ project: { id: string; selectedWorktreePath: string | null }; runtime: { phase: string; worktreePath: string | null } }>;
}

describe("real multi-project switching", () => {
  let fixture: ControllerFixture | undefined;
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it("switches one of three real Git projects without restarting the others or changing ports", async () => {
    fixture = await startControllerFixture(3);
    for (const project of fixture.projects) {
      await fixture.request(`/api/projects/${project.id}/operation`, { method: "POST", body: JSON.stringify({ operation: "start", worktreePath: project.main }) });
    }
    const before = await Promise.all(fixture.projects.map((project) => endpointIdentity(project)));

    const target = fixture.projects[0]!;
    await fixture.request(`/api/projects/${target.id}/operation`, { method: "POST", body: JSON.stringify({ operation: "switch", worktreePath: target.alternate }) });
    const after = await Promise.all(fixture.projects.map((project) => endpointIdentity(project)));

    expect(after[0]).toMatchObject({ identity: `${target.name}:alternate` });
    expect(after[0]!.boot).not.toBe(before[0]!.boot);
    expect(after.slice(1)).toEqual(before.slice(1));
    const dashboard = await fixture.request<Dashboard>("/api/dashboard");
    expect(dashboard.projects).toHaveLength(3);
    expect(dashboard.projects.find(({ project }) => project.id === target.id)).toMatchObject({
      project: { selectedWorktreePath: target.alternate },
      runtime: { phase: "running", worktreePath: target.alternate },
    });
  });
});
