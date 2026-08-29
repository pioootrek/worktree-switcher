import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DirectoryBrowser } from "./directory-browser";

const directories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
describe("DirectoryBrowser", () => {
  it("returns only directories and provides bounded parent navigation", async () => {
    const root = temporaryDirectory("worktree-switcher-browser-");
    mkdirSync(join(root, "beta"));
    mkdirSync(join(root, "Alpha"));
    const browser = new DirectoryBrowser(root);

    const listing = await browser.list();
    expect(listing.parent).toBeNull();
    expect(listing.directories.map((entry) => entry.name)).toEqual(["Alpha", "beta"]);

    const child = await browser.list(join(root, "Alpha"));
    expect(child.parent).toBe(root);
  });

  it("rejects direct and symlinked paths outside the configured root", async () => {
    const root = temporaryDirectory("worktree-switcher-browser-root-");
    const outside = temporaryDirectory("worktree-switcher-browser-outside-");
    symlinkSync(outside, join(root, "escape"));
    const browser = new DirectoryBrowser(root);

    await expect(browser.list(outside)).rejects.toThrow("poza dozwolonym");
    await expect(browser.list(join(root, "escape"))).rejects.toThrow("poza dozwolonym");
  });
});
