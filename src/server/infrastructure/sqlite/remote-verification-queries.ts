import type {
  RemotePrincipal,
  RemotePrincipalProjectGrant,
  RemoteProjectIdentity,
  RemoteVerificationRequest,
  RemoteWorkerProjectGrant,
  RemoteWorkerRegistration,
} from "@/server/modules/remote-verification";
import Database from "better-sqlite3";

type PrincipalRow = { id: string; kind: RemotePrincipal["kind"]; status: RemotePrincipal["status"] };
type ProjectRow = { id: string; name: string; source_remote: string; status: RemoteProjectIdentity["status"] };
type WorkerRow = {
  id: string;
  principal_id: string;
  name: string;
  status: RemoteWorkerRegistration["status"];
  last_contact_at: string | null;
};
type PrincipalGrantRow = { principal_id: string; project_id: string; permissions_json: string; revoked_at: string | null };
type WorkerGrantRow = {
  worker_id: string;
  project_id: string;
  local_project_id: string;
  preset_ids_json: string;
  revoked_at: string | null;
};
type RequestRow = {
  id: string;
  project_id: string;
  worker_id: string;
  requested_by: string;
  commit_sha: string;
  preset_id: string;
  idempotency_key: string;
  phase: RemoteVerificationRequest["phase"];
  created_at: string;
  updated_at: string;
};

function mapRequest(row: RequestRow): RemoteVerificationRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    workerId: row.worker_id,
    requestedBy: row.requested_by,
    commitSha: row.commit_sha,
    presetId: row.preset_id,
    idempotencyKey: row.idempotency_key,
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Borrows the controller's owner connection and never opens or closes a database. */
export class RemoteVerificationQueries {
  constructor(private readonly database: Database.Database) {}

  getRemotePrincipal(id: string): RemotePrincipal | null {
    return (this.database.prepare("SELECT id, kind, status FROM remote_principals WHERE id = ?").get(id) as PrincipalRow | undefined) ?? null;
  }

  saveRemotePrincipal(principal: RemotePrincipal, actor: string): void {
    const existing = this.getRemotePrincipal(principal.id);
    if (existing && existing.kind !== principal.kind) {
      throw new Error("Nie można zmienić rodzaju istniejącej tożsamości zdalnej.");
    }
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_principals(id, kind, status) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status
      `).run(principal.id, principal.kind, principal.status);
      this.audit("remote.principal_saved", actor, principal);
    })();
  }

  getRemoteProjectIdentity(id: string): RemoteProjectIdentity | null {
    const row = this.database.prepare("SELECT id, name, source_remote, status FROM remote_project_identities WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return row ? { id: row.id, name: row.name, sourceRemote: row.source_remote, status: row.status } : null;
  }

  saveRemoteProjectIdentity(project: RemoteProjectIdentity, actor: string): void {
    const existing = this.getRemoteProjectIdentity(project.id);
    if (existing && existing.sourceRemote !== project.sourceRemote) {
      throw new Error("Nie można zmienić źródłowego remote istniejącego projektu zdalnego.");
    }
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_project_identities(id, name, source_remote, status) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status
      `).run(project.id, project.name, project.sourceRemote, project.status);
      this.audit("remote.project_saved", actor, project);
    })();
  }

  getRemoteWorker(id: string): RemoteWorkerRegistration | null {
    const row = this.database.prepare("SELECT id, principal_id, name, status, last_contact_at FROM remote_workers WHERE id = ?")
      .get(id) as WorkerRow | undefined;
    return row ? {
      id: row.id,
      principalId: row.principal_id,
      name: row.name,
      status: row.status,
      lastContactAt: row.last_contact_at,
    } : null;
  }

  saveRemoteWorker(worker: RemoteWorkerRegistration, actor: string): void {
    const existing = this.getRemoteWorker(worker.id);
    if (existing && existing.principalId !== worker.principalId) {
      throw new Error("Nie można zmienić tożsamości istniejącego workera zdalnego.");
    }
    const principalOwner = this.database.prepare("SELECT id FROM remote_workers WHERE principal_id = ?")
      .get(worker.principalId) as { id: string } | undefined;
    if (principalOwner && principalOwner.id !== worker.id) {
      throw new Error("Tożsamość zdalna jest już przypisana do innego workera.");
    }
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_workers(id, principal_id, name, status, last_contact_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, status = excluded.status, last_contact_at = excluded.last_contact_at
      `).run(worker.id, worker.principalId, worker.name, worker.status, worker.lastContactAt);
      this.audit("remote.worker_saved", actor, worker);
    })();
  }

  getRemotePrincipalProjectGrant(principalId: string, projectId: string): RemotePrincipalProjectGrant | null {
    const row = this.database.prepare(`
      SELECT principal_id, project_id, permissions_json, revoked_at
      FROM remote_principal_project_grants WHERE principal_id = ? AND project_id = ?
    `).get(principalId, projectId) as PrincipalGrantRow | undefined;
    return row ? {
      principalId: row.principal_id,
      projectId: row.project_id,
      permissions: JSON.parse(row.permissions_json) as RemotePrincipalProjectGrant["permissions"],
      revokedAt: row.revoked_at,
    } : null;
  }

  saveRemotePrincipalProjectGrant(grant: RemotePrincipalProjectGrant, actor: string): void {
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_principal_project_grants(principal_id, project_id, permissions_json, revoked_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(principal_id, project_id) DO UPDATE SET
          permissions_json = excluded.permissions_json, revoked_at = excluded.revoked_at
      `).run(grant.principalId, grant.projectId, JSON.stringify(grant.permissions), grant.revokedAt);
      this.audit("remote.principal_project_grant_saved", actor, grant);
    })();
  }

  getRemoteWorkerProjectGrant(workerId: string, projectId: string): RemoteWorkerProjectGrant | null {
    const row = this.database.prepare(`
      SELECT worker_id, project_id, local_project_id, preset_ids_json, revoked_at
      FROM remote_worker_project_grants WHERE worker_id = ? AND project_id = ?
    `).get(workerId, projectId) as WorkerGrantRow | undefined;
    return row ? {
      workerId: row.worker_id,
      projectId: row.project_id,
      localProjectId: row.local_project_id,
      presetIds: JSON.parse(row.preset_ids_json) as string[],
      revokedAt: row.revoked_at,
    } : null;
  }

  saveRemoteWorkerProjectGrant(grant: RemoteWorkerProjectGrant, actor: string): void {
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_worker_project_grants(worker_id, project_id, local_project_id, preset_ids_json, revoked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(worker_id, project_id) DO UPDATE SET
          local_project_id = excluded.local_project_id,
          preset_ids_json = excluded.preset_ids_json,
          revoked_at = excluded.revoked_at
      `).run(grant.workerId, grant.projectId, grant.localProjectId, JSON.stringify(grant.presetIds), grant.revokedAt);
      this.audit("remote.worker_project_grant_saved", actor, grant);
    })();
  }

  findRemoteVerificationRequestByIdempotency(principalId: string, idempotencyKey: string): RemoteVerificationRequest | null {
    const row = this.database.prepare(`
      SELECT * FROM remote_verification_requests WHERE requested_by = ? AND idempotency_key = ?
    `).get(principalId, idempotencyKey) as RequestRow | undefined;
    return row ? mapRequest(row) : null;
  }

  createOrReplayRemoteVerificationRequest(request: RemoteVerificationRequest): RemoteVerificationRequest {
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO remote_verification_requests(
          id, project_id, worker_id, requested_by, commit_sha, preset_id,
          idempotency_key, phase, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(requested_by, idempotency_key) DO NOTHING
      `).run(
        request.id,
        request.projectId,
        request.workerId,
        request.requestedBy,
        request.commitSha,
        request.presetId,
        request.idempotencyKey,
        request.phase,
        request.createdAt,
        request.updatedAt,
      );
      const persisted = this.findRemoteVerificationRequestByIdempotency(request.requestedBy, request.idempotencyKey);
      if (!persisted) throw new Error("Nie udało się zapisać zlecenia zdalnej weryfikacji.");
      return persisted;
    }).immediate();
  }

  private audit(eventType: string, actor: string, details: unknown): void {
    this.database.prepare(`
      INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(eventType, actor, JSON.stringify(details), new Date().toISOString());
  }
}
