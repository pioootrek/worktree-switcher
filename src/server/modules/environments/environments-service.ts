import { type LogWriter } from "@/server/log-writer";
import type { StateStore } from "@/server/state-store";
import type { ProjectView, RedactedTestEnvironmentProfile, TestEnvironmentProfile } from "@/shared/contracts";
import type { RuntimeCapacity } from "../lifecycle";
import { type LifecycleAccess, type OperationActor } from "../lifecycle";
import type { ProfileRuntime } from "../runtime";
import { validateEnvironment, validateProfileName, validateTestProfile } from "./profile-validation";
import { redactProject, redactTestProfile } from "./project-view";
import { BUILT_IN_TEST_PROFILES, SYSTEM_ENVIRONMENT_ALLOWLIST } from "./test-environment";

export class EnvironmentService {
  constructor(
    private readonly store: Pick<StateStore, "updateProjectEnvironment" | "saveProjectEnvironmentProfile" | "selectProjectEnvironmentProfile" | "deleteProjectEnvironmentProfile" | "saveProjectTestEnvironmentProfile" | "deleteProjectTestEnvironmentProfile" | "assignProjectTestPresetProfile">,
    private readonly logs: Pick<LogWriter, "controller">,
    private readonly lifecycle: Pick<LifecycleAccess, "serialized" | "requireProject" | "assertReservationAllows"> & Pick<RuntimeCapacity, "acquireCapacity" | "releaseCapacity" | "isProjectActive">,
    private readonly runtime: ProfileRuntime,
  ) {}

  async setProjectEnvironment(projectId: string, environment: Record<string, string>, actor: OperationActor = { owner: "local-user" }): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      if (this.lifecycle.isProjectActive(projectId)) {
        throw new Error("Zatrzymaj serwer przed zmianą zmiennych środowiskowych.");
      }
      const normalized = validateEnvironment(environment);
      this.store.updateProjectEnvironment(project.id, normalized, actor.owner);
      this.logs.controller("project.environment_updated", { projectId, variableNames: Object.keys(normalized), actor: actor.owner });
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  async saveEnvironmentProfile(projectId: string, name: string, environment: Record<string, string>, actor: OperationActor = { owner: "local-user" }, restart = false): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      const profileName = validateProfileName(name);
      const normalized = validateEnvironment(environment);
      const active = this.lifecycle.isProjectActive(projectId);
      const changesActiveProfile = project.selectedEnvironmentProfile === profileName;
      if (active && changesActiveProfile && !restart) throw new Error("Zatrzymaj serwer lub wybierz zapis z restartem.");
      if (active && changesActiveProfile) this.lifecycle.acquireCapacity(project);
      try {
        if (active && changesActiveProfile) await this.runtime.operateLocked(projectId, "stop", undefined, actor);
        this.store.saveProjectEnvironmentProfile(projectId, { name: profileName, environment: normalized }, actor.owner);
        this.logs.controller("project.environment_profile_saved", { projectId, profileName, variableNames: Object.keys(normalized), actor: actor.owner });
        if (active && changesActiveProfile) await this.runtime.operateLocked(projectId, "start", undefined, actor);
      } finally {
        if (active && changesActiveProfile) this.lifecycle.releaseCapacity(projectId);
      }
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  async selectEnvironmentProfile(projectId: string, name: string, actor: OperationActor = { owner: "local-user" }, restart = false): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      const profileName = validateProfileName(name);
      if (!project.environmentProfiles.some((profile) => profile.name === profileName)) throw new Error("Nie znaleziono profilu środowiska.");
      if (project.selectedEnvironmentProfile === profileName) return redactProject(project);
      const active = this.lifecycle.isProjectActive(projectId);
      if (active && !restart) throw new Error("Zatrzymaj serwer lub wybierz profil z restartem.");
      if (active) this.lifecycle.acquireCapacity(project);
      try {
        if (active) await this.runtime.operateLocked(projectId, "stop", undefined, actor);
        this.store.selectProjectEnvironmentProfile(projectId, profileName, actor.owner);
        this.logs.controller("project.environment_profile_selected", { projectId, profileName, actor: actor.owner });
        if (active) await this.runtime.operateLocked(projectId, "start", undefined, actor);
      } finally {
        if (active) this.lifecycle.releaseCapacity(projectId);
      }
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  async deleteEnvironmentProfile(projectId: string, name: string, actor: OperationActor = { owner: "local-user" }): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      const profileName = validateProfileName(name);
      if (profileName === "default") throw new Error("Profilu default nie można usunąć.");
      if (project.selectedEnvironmentProfile === profileName) throw new Error("Nie można usunąć aktywnego profilu środowiska.");
      if (!project.environmentProfiles.some((profile) => profile.name === profileName)) throw new Error("Nie znaleziono profilu środowiska.");
      const testProfiles = project.testEnvironmentProfiles
        .filter((profile) => profile.policy.mode === "inherit-server-profile" && profile.policy.serverProfile === profileName)
        .map((profile) => profile.name);
      if (testProfiles.length > 0) throw new Error(`Profil środowiska jest używany przez profile testowe: ${testProfiles.join(", ")}.`);
      this.store.deleteProjectEnvironmentProfile(projectId, profileName, actor.owner);
      this.logs.controller("project.environment_profile_deleted", { projectId, profileName, actor: actor.owner });
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  testEnvironmentProfiles(projectId: string): {
    profiles: RedactedTestEnvironmentProfile[];
    presetProfiles: Record<string, string>;
    systemVariableNames: string[];
  } {
    const project = this.lifecycle.requireProject(projectId);
    return {
      profiles: project.testEnvironmentProfiles.map(redactTestProfile),
      presetProfiles: project.testPresetProfiles,
      systemVariableNames: [...SYSTEM_ENVIRONMENT_ALLOWLIST, "LC_*"],
    };
  }

  async saveTestEnvironmentProfile(
    projectId: string,
    input: { name: string; environment: Record<string, string>; mode?: TestEnvironmentProfile["policy"]["mode"]; serverProfile?: string | null; nodeEnv?: TestEnvironmentProfile["nodeEnv"]; requiredVariables?: string[] },
    actor: OperationActor = { owner: "local-user" },
  ): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      const profile = validateTestProfile(project, input);
      if (BUILT_IN_TEST_PROFILES.some((candidate) => candidate.name === profile.name)) {
        throw new Error("Wbudowanego profilu testowego nie można zastąpić.");
      }
      this.store.saveProjectTestEnvironmentProfile(projectId, profile, actor.owner);
      this.logs.controller("project.test_profile_saved", {
        projectId,
        profileName: profile.name,
        mode: profile.policy.mode,
        inheritedServerProfile: profile.policy.serverProfile,
        variableNames: Object.keys(profile.environment),
        actor: actor.owner,
      });
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  async deleteTestEnvironmentProfile(projectId: string, name: string, actor: OperationActor = { owner: "local-user" }): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      const profileName = validateProfileName(name);
      if (BUILT_IN_TEST_PROFILES.some((profile) => profile.name === profileName)) throw new Error("Wbudowanego profilu testowego nie można usunąć.");
      if (!project.testEnvironmentProfiles.some((profile) => profile.name === profileName)) throw new Error("Nie znaleziono profilu testowego.");
      const assigned = Object.entries(project.testPresetProfiles).filter(([, assignment]) => assignment === profileName).map(([presetId]) => presetId);
      if (assigned.length > 0) throw new Error(`Profil testowy jest przypisany do presetów: ${assigned.join(", ")}.`);
      this.store.deleteProjectTestEnvironmentProfile(projectId, profileName, actor.owner);
      this.logs.controller("project.test_profile_deleted", { projectId, profileName, actor: actor.owner });
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }

  async assignTestPresetProfile(projectId: string, presetId: string, name: string | null, actor: OperationActor = { owner: "local-user" }): Promise<ProjectView> {
    return this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      this.lifecycle.assertReservationAllows(projectId, project.selectedWorktreePath, actor);
      if (!presetId.trim() || presetId.length > 160) throw new Error("Nieprawidłowy identyfikator presetu testowego.");
      const profileName = name === null ? null : validateProfileName(name);
      if (profileName && !project.testEnvironmentProfiles.some((profile) => profile.name === profileName)) {
        throw new Error("Nie znaleziono profilu testowego.");
      }
      this.store.assignProjectTestPresetProfile(projectId, presetId.trim(), profileName, actor.owner);
      this.logs.controller("project.test_preset_profile_assigned", { projectId, presetId, profileName, actor: actor.owner });
      return redactProject(this.lifecycle.requireProject(projectId));
    });
  }
}
