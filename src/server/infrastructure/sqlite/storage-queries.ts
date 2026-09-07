import type { WorktreeStorageSample } from "@/server/state-store";
import type { WorktreeStorageHistoryPoint, WorktreeStorageSnapshot } from "@/shared/contracts";
import Database from "better-sqlite3";

type StorageRow = {
  project_id: string;
  worktree_path: string;
  total_bytes: number;
  next_bytes: number;
  next_cache_bytes: number;
  node_modules_bytes: number;
  top_directories_json: string;
  measured_at: string;
};

/** Borrows the owner connection; never opens or closes a database. */
export class StorageQueries {
  constructor(private readonly database: Database.Database) {}

  getWorktreeStorage(projectId: string, worktreePath: string): WorktreeStorageSnapshot | null {
    const rows = this.database.prepare(`
      SELECT project_id, worktree_path, total_bytes, next_bytes, next_cache_bytes,
             node_modules_bytes, top_directories_json, measured_at
      FROM worktree_storage_samples
      WHERE project_id = ? AND worktree_path = ?
      ORDER BY measured_at ASC, id ASC
    `).all(projectId, worktreePath) as StorageRow[];
    const latest = rows.at(-1);
    if (!latest) return null;
    const history: WorktreeStorageHistoryPoint[] = rows.map((row) => ({
      measuredAt: row.measured_at,
      totalBytes: row.total_bytes,
      nextBytes: row.next_bytes,
      nextCacheBytes: row.next_cache_bytes,
      nodeModulesBytes: row.node_modules_bytes,
    }));
    return {
      worktreePath,
      status: "available",
      totalBytes: latest.total_bytes,
      nextBytes: latest.next_bytes,
      nextCacheBytes: latest.next_cache_bytes,
      nodeModulesBytes: latest.node_modules_bytes,
      otherBytes: Math.max(0, latest.total_bytes - latest.next_bytes - latest.node_modules_bytes),
      measuredAt: latest.measured_at,
      topDirectories: JSON.parse(latest.top_directories_json) as Array<{ name: string; bytes: number }>,
      history,
      error: null,
    };
  }

  saveWorktreeStorage(sample: WorktreeStorageSample): void {
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO worktree_storage_samples(
          project_id, worktree_path, total_bytes, next_bytes, next_cache_bytes,
          node_modules_bytes, top_directories_json, measured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sample.projectId,
        sample.worktreePath,
        sample.totalBytes,
        sample.nextBytes,
        sample.nextCacheBytes,
        sample.nodeModulesBytes,
        JSON.stringify(sample.topDirectories),
        sample.measuredAt,
      );
      const rows = this.database.prepare(`
        SELECT id FROM worktree_storage_samples
        WHERE project_id = ? AND worktree_path = ?
        ORDER BY measured_at ASC, id ASC
      `).all(sample.projectId, sample.worktreePath) as Array<{ id: number }>;
      const obsolete = rows.length > 180 ? rows.slice(1, rows.length - 179) : [];
      const remove = this.database.prepare("DELETE FROM worktree_storage_samples WHERE id = ?");
      for (const row of obsolete) remove.run(row.id);
    })();
  }
}
