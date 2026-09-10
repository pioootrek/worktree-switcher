import { describe, expect, it } from "vitest";

import { directControllerOrigin, parsePublicControllerOrigin, validatePublicControllerBackend } from "./controller-addresses";

describe("controller address contract", () => {
  it("canonicalizes an explicit HTTPS public origin", () => {
    expect(parsePublicControllerOrigin("https://switcher.example.test:443/")).toBe("https://switcher.example.test");
    expect(parsePublicControllerOrigin("https://[fd00::10]:8443/")).toBe("https://[fd00::10]:8443");
  });

  it.each([
    "http://switcher.example.test",
    "https://user:secret@switcher.example.test",
    "https://switcher.example.test/dashboard",
    "https://switcher.example.test/?mode=admin",
    "https://switcher.example.test/#token=secret",
  ])("rejects an unsafe public URL: %s", (value) => {
    expect(() => parsePublicControllerOrigin(value)).toThrow("public URL");
  });

  it("formats IPv4, hostnames and IPv6 listening addresses as origins", () => {
    expect(directControllerOrigin("192.168.1.20", 47831)).toBe("http://192.168.1.20:47831");
    expect(directControllerOrigin("switcher.local", 47831)).toBe("http://switcher.local:47831");
    expect(directControllerOrigin("::1", 47831)).toBe("http://[::1]:47831");
  });

  it("requires the first proxy mode to use a loopback backend", () => {
    expect(() => validatePublicControllerBackend("127.0.0.1", "https://switcher.example.test")).not.toThrow();
    expect(() => validatePublicControllerBackend("::1", "https://switcher.example.test")).not.toThrow();
    expect(() => validatePublicControllerBackend("0.0.0.0", "https://switcher.example.test")).toThrow("loopback");
    expect(() => validatePublicControllerBackend("192.168.1.20", "https://switcher.example.test")).toThrow("loopback");
    expect(() => validatePublicControllerBackend("0.0.0.0", undefined)).not.toThrow();
  });
});
