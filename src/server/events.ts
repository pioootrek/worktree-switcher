import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { DashboardChangeEvent, DashboardChangeKind } from "@/shared/contracts";

const MAX_PENDING_PROJECT_IDS = 128;

export interface ChangeInput {
  kinds?: DashboardChangeKind[];
  projectIds?: string[];
}

export class EventStream {
  private readonly clients = new Set<ServerResponse>();
  private pending: NodeJS.Timeout | null = null;
  private readonly epoch = randomUUID();
  private revision = 0;
  private readonly pendingKinds = new Set<DashboardChangeKind>();
  private readonly pendingProjectIds = new Set<string>();
  private allProjects = false;

  add(response: ServerResponse): void {
    this.clients.add(response);
    response.write(`event: ready\ndata: ${JSON.stringify(this.version())}\n\n`);
    response.once("close", () => this.clients.delete(response));
  }

  publish = (input: ChangeInput = {}): void => {
    for (const kind of input.kinds ?? ["topology"]) this.pendingKinds.add(kind);
    for (const projectId of input.projectIds ?? []) {
      if (this.pendingProjectIds.size >= MAX_PENDING_PROJECT_IDS) {
        this.pendingProjectIds.clear();
        this.allProjects = true;
        break;
      }
      this.pendingProjectIds.add(projectId);
    }
    if (!input.projectIds?.length) this.allProjects = true;
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      const event: DashboardChangeEvent = {
        ...this.version(true),
        kinds: [...this.pendingKinds],
        projectIds: [...this.pendingProjectIds],
        allProjects: this.allProjects,
        at: new Date().toISOString(),
      };
      this.pendingKinds.clear();
      this.pendingProjectIds.clear();
      this.allProjects = false;
      const message = `event: changed\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of this.clients) {
        if (!client.write(message)) {
          this.clients.delete(client);
          client.end();
        }
      }
    }, 250);
    this.pending.unref();
  };

  close(): void {
    if (this.pending) clearTimeout(this.pending);
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.pendingKinds.clear();
    this.pendingProjectIds.clear();
  }

  version(increment = false): Pick<DashboardChangeEvent, "epoch" | "revision"> {
    if (increment) this.revision += 1;
    return { epoch: this.epoch, revision: this.revision };
  }
}
