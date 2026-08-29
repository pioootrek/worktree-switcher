import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LaunchCommand {
  executable: "pnpm" | "npm" | "yarn" | "bun";
  args: string[];
  portMethod: "environment" | "argument";
  tls: NextTlsConfiguration;
}

export interface NextTlsConfiguration {
  mode: "off" | "generated" | "custom";
  keyPath: string | null;
  certPath: string | null;
  caPath: string | null;
}

export interface LaunchCommandResolver {
  resolve(worktreePath: string, port: number, tls?: NextTlsConfiguration): LaunchCommand;
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

function forwardedArgs(manager: LaunchCommand["executable"], args: string[]): string[] {
  return manager === "npm" ? ["--", ...args] : args;
}

function canonicalFile(path: string | null, label: string, required: boolean): string | null {
  if (!path) {
    if (required) throw new Error(`Wskaż plik: ${label}.`);
    return null;
  }
  try {
    const canonical = realpathSync(path);
    if (!statSync(canonical).isFile()) throw new Error();
    return canonical;
  } catch {
    throw new Error(`Nie można odczytać pliku ${label}: ${path}`);
  }
}

function resolveTls(packageJson: PackageJson, input: NextTlsConfiguration): NextTlsConfiguration {
  const packages = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (input.mode !== "off" && !("next" in packages)) {
    throw new Error("HTTPS zarządzany przez Switcher jest obecnie obsługiwany tylko dla Next.js.");
  }
  if (input.mode !== "custom") return { mode: input.mode, keyPath: null, certPath: null, caPath: null };
  return {
    mode: "custom",
    keyPath: canonicalFile(input.keyPath, "klucz prywatny", true),
    certPath: canonicalFile(input.certPath, "certyfikat", true),
    caPath: canonicalFile(input.caPath, "CA", false),
  };
}

function tlsArgs(tls: NextTlsConfiguration): string[] {
  if (tls.mode === "off") return [];
  if (tls.mode === "generated") return ["--experimental-https"];
  return [
    "--experimental-https",
    "--experimental-https-key", tls.keyPath!,
    "--experimental-https-cert", tls.certPath!,
    ...(tls.caPath ? ["--experimental-https-ca", tls.caPath] : []),
  ];
}

export class NodeLaunchCommandResolver implements LaunchCommandResolver {
  resolve(
    worktreePath: string,
    port: number,
    tlsInput: NextTlsConfiguration = { mode: "off", keyPath: null, certPath: null, caPath: null },
  ): LaunchCommand {
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
    const tls = resolveTls(packageJson, tlsInput);
    const devArgs = [
      ...(passPortAsArgument ? ["--port", String(port)] : []),
      ...tlsArgs(tls),
    ];
    return {
      executable,
      args: ["run", "dev", ...forwardedArgs(executable, devArgs)],
      portMethod: passPortAsArgument ? "argument" : "environment",
      tls,
    };
  }
}
