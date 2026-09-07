import type { Project, TestEnvironmentProfile, TestPreset } from "@/shared/contracts";
import { BUILT_IN_TEST_PROFILES, defaultTestProfileName } from "./test-environment";

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENVIRONMENT_NAMES = new Set([
  "PORT", "NODE_ENV", "PATH",
  "NODE_OPTIONS",
  "LD_PRELOAD", "LD_LIBRARY_PATH",
  "PYTHONPATH", "PYTHONSTARTUP", "PYTHONHOME",
]);
const ENVIRONMENT_PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function testProfileFor(project: Project, preset: TestPreset): TestEnvironmentProfile {
  const assigned = project.testPresetProfiles[preset.id];
  const name = assigned ?? defaultTestProfileName(preset);
  const profile = project.testEnvironmentProfiles.find((candidate) => candidate.name === name)
    ?? BUILT_IN_TEST_PROFILES.find((candidate) => candidate.name === name);
  if (!profile) throw new Error(`Preset ${preset.id} wskazuje nieistniejący profil testowy ${name}.`);
  return profile;
}

export function validateTestProfile(
  project: Project,
  input: { name: string; environment: Record<string, string>; mode?: TestEnvironmentProfile["policy"]["mode"]; serverProfile?: string | null; nodeEnv?: TestEnvironmentProfile["nodeEnv"]; requiredVariables?: string[] },
): TestEnvironmentProfile {
  const name = validateProfileName(input.name);
  const environment = validateEnvironment(input.environment);
  const mode = input.mode ?? "clean";
  if (mode !== "clean" && mode !== "inherit-server-profile") throw new Error("Nieprawidłowy tryb środowiska testowego.");
  const serverProfile = mode === "inherit-server-profile" ? (input.serverProfile ?? "").trim() : null;
  if (mode === "inherit-server-profile") {
    if (!serverProfile) throw new Error("Dziedziczenie środowiska serwera wymaga jawnej nazwy profilu serwera.");
    if (!project.environmentProfiles.some((profile) => profile.name === serverProfile)) throw new Error("Nie znaleziono profilu środowiska serwera.");
  }
  const nodeEnv = input.nodeEnv ?? null;
  if (nodeEnv !== null && !["development", "production", "test"].includes(nodeEnv)) throw new Error("Nieprawidłowa wartość NODE_ENV profilu testowego.");
  const requiredVariables = [...new Set(input.requiredVariables ?? [])];
  for (const variable of requiredVariables) {
    if (!ENVIRONMENT_NAME.test(variable) || variable.length > 128) throw new Error(`Nieprawidłowa nazwa zmiennej wymaganej: ${variable}.`);
  }
  return { name, policy: { mode, serverProfile }, environment, nodeEnv, requiredVariables: requiredVariables.sort() };
}

export function validateEnvironment(environment: Record<string, string>): Record<string, string> {
  const entries = Object.entries(environment);
  if (entries.length > 100) throw new Error("Można ustawić maksymalnie 100 zmiennych środowiskowych.");
  for (const [name, value] of entries) {
    if (!ENVIRONMENT_NAME.test(name) || name.length > 128) throw new Error(`Nieprawidłowa nazwa zmiennej środowiskowej: ${name}.`);
    if (RESERVED_ENVIRONMENT_NAMES.has(name) || name.startsWith("DYLD_")) throw new Error(`Zmienna ${name} jest zarządzana przez kontroler.`);
    if (typeof value !== "string" || value.length > 8192 || value.includes("\0") || value.includes("\n") || value.includes("\r") || value.trim() !== value) {
      throw new Error(`Nieprawidłowa wartość zmiennej ${name}.`);
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function validateProfileName(name: string): string {
  const normalized = name.trim();
  if (!ENVIRONMENT_PROFILE_NAME.test(normalized) || normalized.length > 40) throw new Error("Nieprawidłowa nazwa profilu środowiska.");
  return normalized;
}
