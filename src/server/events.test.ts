import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventStream } from "./events";

afterEach(() => vi.useRealTimers());

function response(writeResult = true) {
  const emitter = new EventEmitter();
  const messages: string[] = [];
  const end = vi.fn(() => emitter.emit("close"));
  return {
    messages,
    end,
    value: Object.assign(emitter, {
      write: vi.fn((message: string) => { messages.push(message); return writeResult; }),
      end,
    }) as unknown as ServerResponse,
  };
}

describe("EventStream", () => {
  it("merges bounded typed changes and advances one monotonic revision", async () => {
    vi.useFakeTimers();
    const events = new EventStream();
    const client = response();
    events.add(client.value);
    events.publish({ kinds: ["runtime"], projectIds: ["one"] });
    events.publish({ kinds: ["tests"], projectIds: ["two"] });
    await vi.advanceTimersByTimeAsync(250);
    expect(client.messages).toHaveLength(2);
    const payload = JSON.parse(client.messages[1].split("data: ")[1]) as Record<string, unknown>;
    expect(payload).toMatchObject({ revision: 1, kinds: ["runtime", "tests"], projectIds: ["one", "two"], allProjects: false });
    events.close();
  });

  it("disconnects a client that applies backpressure", async () => {
    vi.useFakeTimers();
    const events = new EventStream();
    const client = response(false);
    events.add(client.value);
    events.publish({ kinds: ["storage"], projectIds: ["one"] });
    await vi.advanceTimersByTimeAsync(250);
    expect(client.end).toHaveBeenCalledOnce();
    events.close();
  });
});
