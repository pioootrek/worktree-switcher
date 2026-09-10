import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const cli = fileURLToPath(new URL("./dist/cli/index.js", import.meta.url));
const dashboard = fileURLToPath(new URL("./out/index.html", import.meta.url));
if (!existsSync(cli) || !existsSync(dashboard)) {
  throw new Error("HTTPS artifacts are missing or stale. Run pnpm build before pnpm test:https.");
}
if (!process.env.CADDY_BIN) {
  throw new Error("CADDY_BIN must point to the tested Caddy 2.11.3 binary.");
}

export default defineConfig({
  test: {
    include: ["tests/https/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
