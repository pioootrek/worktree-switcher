import type { PendingTestRun, ProjectRegistration, ReservationRequest, StateStore, TestRunStatusRecord, WorktreeStorageSample } from "@/server/state-store";
import type { Project, Reservation, ServerCapacitySettings, TestEnvironmentProfile, TestQueueSettings, TestRun, TestRunPhase, WorktreeStorageSnapshot } from "@/shared/contracts";
import type {
  RemotePrincipal,
  RemotePrincipalProjectGrant,
  RemoteProjectIdentity,
  RemoteVerificationAttempt,
  RemoteVerificationAttemptStore,
  RemoteVerificationProvisioningStore,
  RemoteVerificationRequest,
  RemoteVerificationRequestPhase,
  RemoteVerificationStore,
  RemoteWorkerProjectGrant,
  RemoteWorkerRegistration,
} from "@/server/modules/remote-verification";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeSchema } from "./migrations";
import { mapProject, type ProjectRow } from "./project-mapping";
import { equalHash, mapReservation, type ReservationRow } from "./reservation-mapping";
import { RemoteVerificationQueries } from "./remote-verification-queries";
import { StorageQueries } from "./storage-queries";
import { TestRunQueries } from "./test-run-queries";

export class SqliteStateStore implements StateStore, RemoteVerificationStore, RemoteVerificationAttemptStore, RemoteVerificationProvisioningStore {
  private readonly database: Database.Database;
  private readonly testRuns: TestRunQueries;
  private readonly storage: StorageQueries;
  private readonly remoteVerification: RemoteVerificationQueries;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 3000");
    initializeSchema(this.database);
    this.testRuns = new TestRunQueries(this.database);
    this.storage = new StorageQueries(this.database);
    this.remoteVerification = new RemoteVerificationQueries(this.database);
  }

  listProjects(): Project[] {
    const rows = this.database.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE").all() as ProjectRow[];
    return rows.map(mapProject);
  }

  getProject(id: string): Project | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  addProject(input: ProjectRegistration): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO projects (
          id, name, repository_path, port, launch_preset, executable, args_json,
          healthcheck_path, startup_timeout_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '/', 45000, ?, ?)
      `).run(id, input.name, input.repositoryPath, input.port, input.launchPreset ?? "auto", input.executable, JSON.stringify(input.args), now, now);
      this.audit(id, "project.created", "local-user", {
        repositoryPath: input.repositoryPath,
        port: input.port,
        launchPreset: input.launchPreset ?? "auto",
        executable: input.executable,
        args: input.args,
      });
    })();
    return this.getProject(id)!;
  }

  removeProject(projectId: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const cancellationRequestedAttempts = this.database.prepare(`
        UPDATE remote_verification_attempts
        SET phase = 'cancel_requested', version = version + 1, last_reported_at = ?
        WHERE phase IN ('assigned', 'preparing', 'running') AND EXISTS (
          SELECT 1 FROM remote_worker_project_grants grant
          JOIN remote_verification_requests request ON request.id = remote_verification_attempts.request_id
          WHERE grant.worker_id = remote_verification_attempts.worker_id
            AND grant.project_id = request.project_id
            AND grant.local_project_id = ?
        )
      `).run(now, projectId).changes;
      const cancelledRemoteRequests = this.database.prepare(`
        UPDATE remote_verification_requests
        SET phase = 'cancelled', updated_at = ?
        WHERE phase = 'pending' AND EXISTS (
          SELECT 1 FROM remote_worker_project_grants grant
          WHERE grant.worker_id = remote_verification_requests.worker_id
            AND grant.project_id = remote_verification_requests.project_id
            AND grant.local_project_id = ?
        )
      `).run(now, projectId).changes;
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('project.removed', ?, ?, ?)
      `).run(actor, JSON.stringify({
        projectId: project.id,
        name: project.name,
        repositoryPath: project.repositoryPath,
        port: project.port,
        cancelledRemoteRequests,
        cancellationRequestedAttempts,
      }), now);
      const result = this.database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
    })();
  }

  updateProjectLaunch(projectId: string, input: {
    tlsMode: "off" | "generated" | "custom";
    tlsKeyPath: string | null;
    tlsCertPath: string | null;
    tlsCaPath: string | null;
    executable: string;
    args: string[];
  }): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET
          tls_mode = ?, tls_key_path = ?, tls_cert_path = ?, tls_ca_path = ?,
          executable = ?, args_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.tlsMode,
        input.tlsKeyPath,
        input.tlsCertPath,
        input.tlsCaPath,
        input.executable,
        JSON.stringify(input.args),
        now,
        projectId,
      );
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, "project.launch_updated", "local-user", input);
    })();
  }

  updateProjectEnvironment(projectId: string, environment: Record<string, string>, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    this.saveProjectEnvironmentProfile(projectId, { name: project.selectedEnvironmentProfile, environment }, actor);
  }

  saveProjectEnvironmentProfile(projectId: string, profile: Project["environmentProfiles"][number], actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profiles = [...project.environmentProfiles.filter(({ name }) => name !== profile.name), profile]
      .sort((left, right) => left.name.localeCompare(right.name));
    const environment = project.selectedEnvironmentProfile === profile.name ? profile.environment : project.environment;
    this.persistEnvironmentProfiles(projectId, profiles, project.selectedEnvironmentProfile, environment, actor, "project.environment_profile_saved", profile.name, Object.keys(profile.environment));
  }

  deleteProjectEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profiles = project.environmentProfiles.filter(({ name }) => name !== profileName);
    this.persistEnvironmentProfiles(projectId, profiles, project.selectedEnvironmentProfile, project.environment, actor, "project.environment_profile_deleted", profileName, []);
  }

  selectProjectEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profile = project.environmentProfiles.find(({ name }) => name === profileName);
    if (!profile) throw new Error("Nie znaleziono profilu środowiska.");
    this.persistEnvironmentProfiles(projectId, project.environmentProfiles, profileName, profile.environment, actor, "project.environment_profile_selected", profileName, Object.keys(profile.environment));
  }

  saveProjectTestEnvironmentProfile(projectId: string, profile: TestEnvironmentProfile, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const profiles = [...project.testEnvironmentProfiles.filter(({ name }) => name !== profile.name), profile]
      .sort((left, right) => left.name.localeCompare(right.name));
    this.persistTestEnvironment(projectId, profiles, project.testPresetProfiles, actor, "project.test_profile_saved", {
      profileName: profile.name,
      mode: profile.policy.mode,
      serverProfile: profile.policy.serverProfile,
      nodeEnv: profile.nodeEnv,
      variableNames: Object.keys(profile.environment).sort(),
    });
  }

  deleteProjectTestEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const profiles = project.testEnvironmentProfiles.filter(({ name }) => name !== profileName);
    this.persistTestEnvironment(projectId, profiles, project.testPresetProfiles, actor, "project.test_profile_deleted", { profileName });
  }

  assignProjectTestPresetProfile(projectId: string, presetId: string, profileName: string | null, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const assignments = { ...project.testPresetProfiles };
    if (profileName) assignments[presetId] = profileName;
    else delete assignments[presetId];
    this.persistTestEnvironment(projectId, project.testEnvironmentProfiles, assignments, actor, "project.test_preset_profile_assigned", { presetId, profileName });
  }

  private persistTestEnvironment(
    projectId: string,
    profiles: TestEnvironmentProfile[],
    presetProfiles: Record<string, string>,
    actor: string,
    eventType: string,
    details: Record<string, unknown>,
  ): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET test_environment_profiles_json = ?, test_preset_profiles_json = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(profiles), JSON.stringify(presetProfiles), now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, eventType, actor, details);
    })();
  }

  private requireProjectRow(projectId: string): Project {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    return project;
  }

  private persistEnvironmentProfiles(
    projectId: string,
    profiles: Project["environmentProfiles"],
    selectedProfile: string,
    environment: Record<string, string>,
    actor: string,
    eventType: string,
    profileName: string,
    variableNames: string[],
  ): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET environment_profiles_json = ?, selected_environment_profile = ?,
          environment_json = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(profiles), selectedProfile, JSON.stringify(environment), now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, eventType, actor, { profileName, variableNames: variableNames.sort() });
    })();
  }

  setSelectedWorktree(projectId: string, path: string): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(
        "UPDATE projects SET selected_worktree_path = ?, updated_at = ? WHERE id = ?",
      ).run(path, now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, "worktree.selected", "local-user", { path });
    })();
  }

  getServerCapacitySettings(): ServerCapacitySettings {
    const row = this.database.prepare("SELECT value_json FROM controller_settings WHERE key = 'server_capacity'")
      .get() as { value_json: string } | undefined;
    if (!row) return { enabled: false, limit: 2 };
    const value = JSON.parse(row.value_json) as Partial<ServerCapacitySettings>;
    return {
      enabled: value.enabled === true,
      limit: Number.isInteger(value.limit) && value.limit! >= 1 && value.limit! <= 64 ? value.limit! : 2,
    };
  }

  setServerCapacitySettings(settings: ServerCapacitySettings): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO controller_settings(key, value_json, updated_at)
        VALUES ('server_capacity', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), now);
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('server_capacity.updated', 'local-user', ?, ?)
      `).run(JSON.stringify(settings), now);
    })();
  }

  getTestQueueSettings(): TestQueueSettings {
    const row = this.database.prepare("SELECT value_json FROM controller_settings WHERE key = 'test_queue'")
      .get() as { value_json: string } | undefined;
    if (!row) return { limit: 1 };
    const value = JSON.parse(row.value_json) as Partial<TestQueueSettings>;
    return { limit: Number.isInteger(value.limit) && value.limit! >= 1 && value.limit! <= 16 ? value.limit! : 1 };
  }

  setTestQueueSettings(settings: TestQueueSettings): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO controller_settings(key, value_json, updated_at)
        VALUES ('test_queue', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), now);
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('test_queue.updated', 'local-user', ?, ?)
      `).run(JSON.stringify(settings), now);
    })();
  }

  countTestRuns(phases: TestRunPhase[], projectId?: string, worktreePath?: string): number {
    return this.testRuns.countTestRuns(phases, projectId, worktreePath);
  }

  listPendingTestRuns(): PendingTestRun[] {
    return this.testRuns.listPendingTestRuns();
  }

  listTestRuns(projectId?: string, limit = 50): TestRun[] {
    return this.testRuns.listTestRuns(projectId, limit);
  }

  hasTestRun(id: string): boolean {
    return this.testRuns.hasTestRun(id);
  }

  getTestRun(id: string): TestRun | null {
    return this.testRuns.getTestRun(id);
  }

  getTestRunStatus(id: string): TestRunStatusRecord | null {
    return this.testRuns.getTestRunStatus(id);
  }

  findTestRunByIdempotency(actor: string, idempotencyKey: string): TestRun | null {
    return this.testRuns.findTestRunByIdempotency(actor, idempotencyKey);
  }

  saveTestRun(run: TestRun, idempotencyKey?: string): void {
    return this.testRuns.saveTestRun(run, idempotencyKey);
  }

  markInterruptedTestRuns(): void {
    return this.testRuns.markInterruptedTestRuns();
  }

  getRemotePrincipal(id: string): RemotePrincipal | null {
    return this.remoteVerification.getRemotePrincipal(id);
  }

  saveRemotePrincipal(principal: RemotePrincipal, actor: string): void {
    this.remoteVerification.saveRemotePrincipal(principal, actor);
  }

  getRemoteProjectIdentity(id: string): RemoteProjectIdentity | null {
    return this.remoteVerification.getRemoteProjectIdentity(id);
  }

  saveRemoteProjectIdentity(project: RemoteProjectIdentity, actor: string): void {
    this.remoteVerification.saveRemoteProjectIdentity(project, actor);
  }

  getRemoteWorker(id: string): RemoteWorkerRegistration | null {
    return this.remoteVerification.getRemoteWorker(id);
  }

  saveRemoteWorker(worker: RemoteWorkerRegistration, actor: string): void {
    this.remoteVerification.saveRemoteWorker(worker, actor);
  }

  getRemotePrincipalProjectGrant(principalId: string, projectId: string): RemotePrincipalProjectGrant | null {
    return this.remoteVerification.getRemotePrincipalProjectGrant(principalId, projectId);
  }

  saveRemotePrincipalProjectGrant(grant: RemotePrincipalProjectGrant, actor: string): void {
    this.remoteVerification.saveRemotePrincipalProjectGrant(grant, actor);
  }

  getRemoteWorkerProjectGrant(workerId: string, projectId: string): RemoteWorkerProjectGrant | null {
    return this.remoteVerification.getRemoteWorkerProjectGrant(workerId, projectId);
  }

  saveRemoteWorkerProjectGrant(grant: RemoteWorkerProjectGrant, actor: string): void {
    this.remoteVerification.saveRemoteWorkerProjectGrant(grant, actor);
  }

  findRemoteVerificationRequestByIdempotency(principalId: string, idempotencyKey: string): RemoteVerificationRequest | null {
    return this.remoteVerification.findRemoteVerificationRequestByIdempotency(principalId, idempotencyKey);
  }

  createOrReplayRemoteVerificationRequest(request: RemoteVerificationRequest): RemoteVerificationRequest {
    return this.remoteVerification.createOrReplayRemoteVerificationRequest(request);
  }

  getRemoteVerificationRequest(id: string): RemoteVerificationRequest | null {
    return this.remoteVerification.getRemoteVerificationRequest(id);
  }

  getRemoteVerificationAttempt(id: string): RemoteVerificationAttempt | null {
    return this.remoteVerification.getRemoteVerificationAttempt(id);
  }

  findRemoteVerificationAttemptForRequest(requestId: string): RemoteVerificationAttempt | null {
    return this.remoteVerification.findRemoteVerificationAttemptForRequest(requestId);
  }

  createOrReplayRemoteVerificationAttempt(attempt: RemoteVerificationAttempt): RemoteVerificationAttempt | null {
    return this.remoteVerification.createOrReplayRemoteVerificationAttempt(attempt);
  }

  updateRemoteVerificationAttempt(
    attempt: RemoteVerificationAttempt,
    expectedVersion: number,
    requestPhase: RemoteVerificationRequestPhase,
  ): boolean {
    return this.remoteVerification.updateRemoteVerificationAttempt(attempt, expectedVersion, requestPhase);
  }

  markRemoteVerificationAttemptsUncertain(observedAt: string): number {
    return this.remoteVerification.markRemoteVerificationAttemptsUncertain(observedAt);
  }

  getWorktreeStorage(projectId: string, worktreePath: string): WorktreeStorageSnapshot | null {
    return this.storage.getWorktreeStorage(projectId, worktreePath);
  }

  saveWorktreeStorage(sample: WorktreeStorageSample): void {
    return this.storage.saveWorktreeStorage(sample);
  }

  recordProjectEvent(projectId: string, eventType: string, actor: string, details: unknown): void {
    this.audit(projectId, eventType, actor, details);
  }

  getActiveReservation(projectId: string): Reservation | null {
    this.expireReservations(projectId);
    const row = this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
             maximum_expires_at, token_hash, idempotency_key, released_at
      FROM reservations WHERE project_id = ? AND released_at IS NULL
    `).get(projectId) as ReservationRow | undefined;
    return row ? mapReservation(row) : null;
  }

  getEffectiveReservation(projectId: string, observedAt: string): Reservation | null {
    const row = this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
             maximum_expires_at, token_hash, idempotency_key, released_at
      FROM reservations
      WHERE project_id = ? AND released_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `).get(projectId, observedAt) as ReservationRow | undefined;
    return row ? mapReservation(row) : null;
  }

  acquireReservation(input: ReservationRequest): Reservation {
    return this.database.transaction(() => {
      this.expireReservations(input.projectId);
      if (input.kind === "agent") {
        if (!input.ttlSeconds || input.ttlSeconds < 30) {
          throw new Error("Dzierżawa agenta musi trwać co najmniej 30 sekund.");
        }
        if (!input.maximumLifetimeSeconds || input.maximumLifetimeSeconds < input.ttlSeconds) {
          throw new Error("Maksymalny czas dzierżawy nie może być krótszy od jej czasu początkowego.");
        }
        if (!input.leaseTokenHash || !input.idempotencyKey) {
          throw new Error("Dzierżawa agenta wymaga tokenu i klucza idempotencji.");
        }
        const repeated = this.database.prepare(`
          SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
                 maximum_expires_at, token_hash, idempotency_key, released_at
          FROM reservations
          WHERE owner = ? AND idempotency_key = ? AND kind = 'agent' AND released_at IS NULL
        `).get(input.owner, input.idempotencyKey) as ReservationRow | undefined;
        if (repeated) {
          if (
            repeated.project_id !== input.projectId
            || repeated.worktree_path !== input.worktreePath
            || !equalHash(repeated.token_hash, input.leaseTokenHash)
          ) {
            throw new Error("Klucz idempotencji jest już używany przez inną dzierżawę.");
          }
          return mapReservation(repeated);
        }
      }
      const active = this.getActiveReservation(input.projectId);
      if (active) throw new Error(`Projekt jest zablokowany przez ${active.owner}.`);
      const createdAt = new Date().toISOString();
      const expiresAt = input.kind === "agent"
        ? new Date(Date.now() + input.ttlSeconds! * 1000).toISOString()
        : null;
      const maximumExpiresAt = input.kind === "agent"
        ? new Date(Date.now() + input.maximumLifetimeSeconds! * 1000).toISOString()
        : null;
      const reservation: Reservation = {
        id: randomUUID(),
        projectId: input.projectId,
        worktreePath: input.worktreePath,
        kind: input.kind,
        owner: input.owner,
        reason: input.reason ?? null,
        createdAt,
        expiresAt,
        maximumExpiresAt,
      };
      this.database.prepare(`
        INSERT INTO reservations (
          id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
          maximum_expires_at, token_hash, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reservation.id,
        reservation.projectId,
        reservation.worktreePath,
        reservation.kind,
        reservation.owner,
        reservation.reason,
        reservation.createdAt,
        reservation.expiresAt,
        reservation.maximumExpiresAt,
        input.leaseTokenHash ?? null,
        input.idempotencyKey ?? null,
      );
      this.audit(input.projectId, "reservation.acquired", input.owner, reservation);
      return reservation;
    })();
  }

  authorizeReservation(projectId: string, owner: string, leaseTokenHash?: string): Reservation | null {
    const reservation = this.getActiveReservation(projectId);
    if (!reservation) return null;
    const row = this.activeReservationRow(projectId)!;
    if (reservation.owner !== owner) throw new Error(`Projekt jest zablokowany przez ${reservation.owner}.`);
    if (reservation.kind === "agent" && (!leaseTokenHash || !equalHash(row.token_hash, leaseTokenHash))) {
      throw new Error("Nieprawidłowy token dzierżawy agenta.");
    }
    return reservation;
  }

  renewAgentReservation(
    projectId: string,
    reservationId: string,
    owner: string,
    leaseTokenHash: string,
    ttlSeconds: number,
  ): Reservation {
    return this.database.transaction(() => {
      if (ttlSeconds < 30) throw new Error("Dzierżawa agenta musi trwać co najmniej 30 sekund.");
      this.expireReservations(projectId);
      const row = this.activeReservationRow(projectId);
      if (!row || row.id !== reservationId) throw new Error("Dzierżawa agenta wygasła lub nie istnieje.");
      if (row.kind !== "agent" || row.owner !== owner || !equalHash(row.token_hash, leaseTokenHash)) {
        throw new Error("Nieprawidłowy token dzierżawy agenta.");
      }
      const maximum = new Date(row.maximum_expires_at!).getTime();
      const expiresAt = new Date(Math.min(Date.now() + ttlSeconds * 1000, maximum)).toISOString();
      if (new Date(expiresAt).getTime() <= Date.now()) throw new Error("Dzierżawa agenta osiągnęła maksymalny czas życia.");
      this.database.prepare("UPDATE reservations SET expires_at = ? WHERE id = ?").run(expiresAt, row.id);
      this.audit(projectId, "reservation.renewed", owner, { id: row.id, expiresAt });
      return { ...mapReservation(row), expiresAt };
    })();
  }

  releaseAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string): void {
    this.database.transaction(() => {
      this.expireReservations(projectId);
      const row = this.activeReservationRow(projectId);
      if (!row || row.id !== reservationId) return;
      if (row.kind !== "agent" || row.owner !== owner || !equalHash(row.token_hash, leaseTokenHash)) {
        throw new Error("Nieprawidłowy token dzierżawy agenta.");
      }
      this.releaseRow(row, owner, false);
    })();
  }

  releaseReservation(projectId: string, owner: string, force = false): void {
    this.database.transaction(() => {
      this.expireReservations(projectId);
      const active = this.getActiveReservation(projectId);
      if (!active) return;
      if (!force && active.kind === "agent") throw new Error("Dzierżawę agenta może zdjąć tylko jej właściciel lub człowiek przez force release.");
      if (!force && active.owner !== owner) throw new Error("Tylko właściciel może zdjąć tę blokadę.");
      const row = this.activeReservationRow(projectId)!;
      this.releaseRow(row, owner, force);
    })();
  }

  close(): void {
    this.database.close();
  }

  private expireReservations(projectId: string): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      const expired = this.database.prepare(`
        SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
               maximum_expires_at, token_hash, idempotency_key, released_at
        FROM reservations
        WHERE project_id = ? AND released_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
      `).all(projectId, now) as ReservationRow[];
      for (const row of expired) {
        this.database.prepare(`
          UPDATE reservations SET released_at = ?, released_by = 'system:expiry' WHERE id = ?
        `).run(now, row.id);
        this.audit(projectId, "reservation.expired", "system:expiry", { id: row.id });
      }
    })();
  }

  private activeReservationRow(projectId: string): ReservationRow | undefined {
    return this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
             maximum_expires_at, token_hash, idempotency_key, released_at
      FROM reservations WHERE project_id = ? AND released_at IS NULL
    `).get(projectId) as ReservationRow | undefined;
  }

  private releaseRow(row: ReservationRow, owner: string, force: boolean): void {
    this.database.prepare(`
      UPDATE reservations SET released_at = ?, released_by = ? WHERE id = ?
    `).run(new Date().toISOString(), owner, row.id);
    this.audit(row.project_id, force ? "reservation.force_released" : "reservation.released", owner, { id: row.id });
  }

  private audit(projectId: string, eventType: string, actor: string, details: unknown): void {
    this.database.prepare(`
      INSERT INTO audit_events(project_id, event_type, actor, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, eventType, actor, JSON.stringify(details), new Date().toISOString());
  }
}
