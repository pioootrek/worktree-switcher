import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function loadOrCreateSecret(path: string): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length < 32) throw new Error(`Secret file is invalid: ${path}`);
    chmodSync(path, 0o600);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const secret = randomBytes(32).toString("base64url");
  try {
    writeFileSync(path, `${secret}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length < 32) throw new Error(`Secret file is invalid: ${path}`);
    chmodSync(path, 0o600);
    return existing;
  }
}
