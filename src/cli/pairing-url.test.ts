import { describe, expect, it } from "vitest";

import { pairingUrl } from "./pairing-url";

describe("pairingUrl", () => {
  it("changes the document URL between controller sessions while keeping the secret in the fragment", () => {
    const first = new URL(pairingUrl("https://switcher.example.test", "secret", "session-a"));
    const second = new URL(pairingUrl("https://switcher.example.test", "secret", "session-b"));

    expect(first.origin).toBe("https://switcher.example.test");
    expect(first.searchParams.get("session")).toBe("session-a");
    expect(first.hash).toBe("#token=secret");
    expect(first.href).not.toBe(second.href);
  });
});
