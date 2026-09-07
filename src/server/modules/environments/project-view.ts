import type { Project, ProjectSnapshot, RedactedTestEnvironmentProfile, TestEnvironmentProfile } from "@/shared/contracts";

export function redactTestProfile(profile: TestEnvironmentProfile): RedactedTestEnvironmentProfile {
  const { environment, ...rest } = profile;
  return { ...rest, variableNames: Object.keys(environment).sort((left, right) => left.localeCompare(right)) };
}

export function redactProject(project: Project): ProjectSnapshot["project"] {
  return {
    ...project,
    testEnvironmentProfiles: project.testEnvironmentProfiles.map(redactTestProfile),
  };
}
