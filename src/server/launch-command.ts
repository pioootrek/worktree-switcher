import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LaunchCommand {
  executable: "pnpm" | "npm" | "yarn" | "bun";
  args: string[];
  portMethod: "environment" | "argument";
}

export interface LaunchCommandResolver {
  resolve(worktreePath: string, port: number): LaunchCommand;
}

type PackageJson = {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
const PORT_ARGUMENT_PACKAGES = ["vite", "astro", "nuxt", "@angular/cli"];

function isPackageManager(value: string): value is LaunchCommand["executable"] {
  return PACKAGE_MANAGERS.some((manager) => manager === value);
}

function detectPackageManager(worktreePath: string, packageJson: PackageJson): LaunchCommand["executable"] {
  if (typeof packageJson.packageManager === "string") {
    const declared = packageJson.packageManager.split("@", 1)[0];
    if (isPackageManager(declared)) return declared;
  }

  const lockfiles: Array<[LaunchCommand["executable"], string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
    ["bun", "bun.lockb"],
    ["npm", "package-lock.json"],
  ];
  return lockfiles.find(([, filename]) => existsSync(join(worktreePath, filename)))?.[0] ?? "npm";
}

function usesPortArgument(packageJson: PackageJson): boolean {
  const packages = { ...packageJson.dependencies, ...packageJson.devDependencies };
  return PORT_ARGUMENT_PACKAGES.some((name) => name in packages);
}

function portArgs(manager: LaunchCommand["executable"], port: number): string[] {
  const argument = ["--port", String(port)];
  return manager === "npm" ? ["--", ...argument] : argument;
}

export class NodeLaunchCommandResolver implements LaunchCommandResolver {
  resolve(worktreePath: string, port: number): LaunchCommand {
    const packageJsonPath = join(worktreePath, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error("Nie znaleziono package.json. Automatyczna konfiguracja obsługuje obecnie projekty Node.js.");
    }

    let packageJson: PackageJson;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
    } catch {
      throw new Error("Nie udało się odczytać package.json. Sprawdź, czy plik zawiera prawidłowy JSON.");
    }
    if (typeof packageJson.scripts?.dev !== "string") {
      throw new Error("Projekt nie ma skryptu dev w package.json.");
    }

    const executable = detectPackageManager(worktreePath, packageJson);
    const passPortAsArgument = usesPortArgument(packageJson);
    return {
      executable,
      args: ["run", "dev", ...(passPortAsArgument ? portArgs(executable, port) : [])],
      portMethod: passPortAsArgument ? "argument" : "environment",
    };
  }
}
