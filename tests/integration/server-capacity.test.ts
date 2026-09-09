import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { endpointIdentity, endpointUnavailable, startControllerFixture, waitFor, type ControllerFixture, type FixtureProject } from "../support/controller-fixture";

interface Capacity { enabled: boolean; limit: number; used: number; available: number | null; holders: Array<{ projectId: string; phase: string }> }
interface Dashboard { capacity: Capacity; projects: Array<{ project: { id: string }; runtime: { phase: string } }> }
interface Compact { status: { runtimePhase: string; serverCapacity: Pick<Capacity, "enabled" | "limit" | "used" | "available">; reservation: unknown } }
interface Claim { reservationId: string; operationErrorCode: string | null; leaseHeld: boolean; status: Compact }

const operation = (fixture: ControllerFixture, project: FixtureProject, action: string, worktreePath = project.main) => fixture.requestResult<{ ok: boolean }>(`/api/projects/${project.id}/operation`, { method: "POST", body: JSON.stringify({ operation: action, worktreePath }) });
const capacity = (fixture: ControllerFixture) => fixture.request<Dashboard>("/api/dashboard").then((value) => value.capacity);
const configure = (fixture: ControllerFixture, enabled: boolean, limit: number) => fixture.request<{ capacity: Capacity }>("/api/settings/capacity", { method: "POST", body: JSON.stringify({ enabled, limit }) });

describe("real server capacity", () => {
  let fixture: ControllerFixture | undefined;
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it("C1: reports HTTP exhaustion and a retained MCP claim separately", async () => {
    fixture = await startControllerFixture(); const [a, b, c] = fixture.projects;
    await configure(fixture, true, 2); await operation(fixture, a!, "start"); await operation(fixture, b!, "start");
    const before = await Promise.all([endpointIdentity(a!), endpointIdentity(b!)]);
    expect((await operation(fixture, c!, "start")).status).toBe(409);
    const mcp = await fixture.mcp();
    try {
      const claim = await mcp.call<Claim>("claim_project", { projectId: c!.id, worktreePath: c!.main, reason: "capacity C1", idempotencyKey: "c1", responseMode: "compact" });
      expect(claim).toMatchObject({ leaseHeld: true, operationErrorCode: "capacity_exhausted", status: { status: { serverCapacity: { used: 2, available: 0 } } } });
      expect(await Promise.all([endpointIdentity(a!), endpointIdentity(b!)])).toEqual(before);
      await endpointUnavailable(c!);
      await mcp.call("release_project_claim", { projectId: c!.id, reservationId: claim.reservationId });
    } finally { await mcp.close(); }
  });

  it.each(["http", "mcp"] as const)("C2: grants the last slot once when %s arrives first", async (first) => {
    fixture = await startControllerFixture(); const [a, b, c] = fixture.projects; await configure(fixture, true, 2); await operation(fixture, a!, "start");
    const mcp = await fixture.mcp(); const admitted = first === "http" ? b! : c!, rejected = first === "http" ? c! : b!;
    await fixture.setMode(admitted, "gate");
    try {
      const pending = first === "http"
        ? operation(fixture, admitted, "start")
        : mcp.call<Claim>("claim_project", { projectId: admitted.id, worktreePath: admitted.main, reason: "capacity C2", idempotencyKey: `c2-${first}`, responseMode: "compact" });
      await waitFor(async () => (await capacity(fixture!)).holders.some((holder) => holder.projectId === admitted.id && holder.phase === "starting") || null, 10_000, () => "admitted start never occupied capacity");
      if (first === "http") {
        const claim = await mcp.call<Claim>("claim_project", { projectId: rejected.id, worktreePath: rejected.main, reason: "capacity C2 rejected", idempotencyKey: "c2-rejected", responseMode: "compact" });
        expect(claim.operationErrorCode).toBe("capacity_exhausted"); await mcp.call("release_project_claim", { projectId: rejected.id, reservationId: claim.reservationId });
      } else expect((await operation(fixture, rejected, "start")).status).toBe(409);
      expect((await capacity(fixture)).used).toBe(2); await fixture.releaseGate(admitted); const result = await pending;
      if (first === "mcp") { const claim = result as Claim; await mcp.call("release_project_claim", { projectId: admitted.id, reservationId: claim.reservationId }); }
      await endpointIdentity(admitted); await endpointUnavailable(rejected);
    } finally { await mcp.close(); }
  });

  it("C3: retains a slot across switch and restart", async () => {
    fixture = await startControllerFixture(); const [a, b, c] = fixture.projects; await configure(fixture, true, 2); await operation(fixture, a!, "start"); await operation(fixture, b!, "start");
    const bIdentity = await endpointIdentity(b!); const blocked = operation(fixture, c!, "start"); await operation(fixture, a!, "switch", a!.alternate); expect((await blocked).status).toBe(409);
    const switched = await endpointIdentity(a!, `${a!.name}:alternate`); expect(switched.identity).toContain("alternate"); expect(await endpointIdentity(b!)).toEqual(bIdentity);
    await operation(fixture, a!, "restart", a!.alternate); const restarted = await endpointIdentity(a!, `${a!.name}:alternate`); expect(restarted.boot).not.toBe(switched.boot); expect((await capacity(fixture)).used).toBe(2);
  });

  it("C4: releases capacity after early exit and readiness timeout cleanup", async () => {
    fixture = await startControllerFixture(); const [a, b] = fixture.projects; await configure(fixture, true, 1);
    await fixture.setMode(a!, "early-exit"); expect((await operation(fixture, a!, "start")).ok).toBe(false); await endpointUnavailable(a!); expect((await capacity(fixture)).used).toBe(0);
    await fixture.setMode(a!, "timeout"); expect((await operation(fixture, a!, "start")).ok).toBe(false); await endpointUnavailable(a!); expect((await capacity(fixture)).used).toBe(0);
    expect((await operation(fixture, b!, "start")).ok).toBe(true); await endpointIdentity(b!);
  }, 110_000);

  it("C5: preserves survivors when lowering and persists settings across restart", async () => {
    fixture = await startControllerFixture(); const [a, b] = fixture.projects; await configure(fixture, true, 2); await operation(fixture, a!, "start"); await operation(fixture, b!, "start");
    const identities = await Promise.all([endpointIdentity(a!), endpointIdentity(b!)]); await configure(fixture, true, 1); expect(await Promise.all([endpointIdentity(a!), endpointIdentity(b!)])).toEqual(identities); expect(await capacity(fixture)).toMatchObject({ limit: 1, used: 2, available: 0 });
    await fixture.restart(); expect(await capacity(fixture)).toMatchObject({ enabled: true, limit: 1, used: 0, available: 1 }); await configure(fixture, false, 1); expect((await capacity(fixture)).available).toBeNull(); await configure(fixture, true, 2);
  });

  it("C6: refuses an unrelated port owner without consuming capacity", async () => {
    fixture = await startControllerFixture(); const c = fixture.projects[2]!; const unrelated = createServer((_, response) => response.end("unrelated"));
    await new Promise<void>((resolve, reject) => unrelated.listen(c.port, "127.0.0.1", resolve).once("error", reject));
    try { expect((await operation(fixture, c, "start")).ok).toBe(false); expect(await (await fetch(`http://127.0.0.1:${c.port}`)).text()).toBe("unrelated"); expect((await capacity(fixture)).used).toBe(0); }
    finally { await new Promise<void>((resolve, reject) => unrelated.close((error) => error ? reject(error) : resolve())); }
  });

  it("C7: graceful controller shutdown closes every owned listener", async () => {
    fixture = await startControllerFixture(); const [a, b] = fixture.projects; await operation(fixture, a!, "start"); await operation(fixture, b!, "start"); await Promise.all([endpointIdentity(a!), endpointIdentity(b!)]);
    await fixture.stop(); await Promise.all([endpointUnavailable(a!), endpointUnavailable(b!)]);
  });
});
