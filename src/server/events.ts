import type { ServerResponse } from "node:http";

export class EventStream {
  private readonly clients = new Set<ServerResponse>();
  private pending: NodeJS.Timeout | null = null;

  add(response: ServerResponse): void {
    this.clients.add(response);
    response.write("event: ready\ndata: {}\n\n");
    response.once("close", () => this.clients.delete(response));
  }

  publish = (): void => {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      const message = `event: changed\ndata: {"at":"${new Date().toISOString()}"}\n\n`;
      for (const client of this.clients) client.write(message);
    }, 250);
    this.pending.unref();
  };

  close(): void {
    if (this.pending) clearTimeout(this.pending);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
