import { type Translate } from "@/i18n/messages";
import type { ProjectView, RuntimeFailure } from "@/shared/contracts";

export function localizedFailure(project: ProjectView, failure: RuntimeFailure, t: Translate) {
  const values = { port: project.port, executable: project.executable };
  switch (failure.code) {
    case "port_in_use":
      return {
        title: t("failure.port_in_use.title", values),
        message: t("failure.port_in_use.message"),
        suggestion: t("failure.port_in_use.suggestion"),
      };
    case "missing_dev_script":
      return {
        title: t("failure.missing_dev_script.title"),
        message: t("failure.missing_dev_script.message"),
        suggestion: t("failure.missing_dev_script.suggestion"),
      };
    case "invalid_arguments":
      return {
        title: t("failure.invalid_arguments.title"),
        message: t("failure.invalid_arguments.message"),
        suggestion: t("failure.invalid_arguments.suggestion"),
      };
    case "missing_executable":
      return {
        title: t("failure.missing_executable.title", values),
        message: t("failure.missing_executable.message"),
        suggestion: t("failure.missing_executable.suggestion"),
      };
    case "resource_limit":
      return {
        title: t("failure.resource_limit.title"),
        message: t("failure.resource_limit.message"),
        suggestion: t("failure.resource_limit.suggestion"),
      };
    case "startup_timeout":
      return {
        title: t("failure.startup_timeout.title", values),
        message: t("failure.startup_timeout.message", values),
        suggestion: t("failure.startup_timeout.suggestion"),
      };
    case "process_exit":
      return {
        title: t("failure.process_exit.title"),
        message: t("failure.process_exit.message"),
        suggestion: t("failure.process_exit.suggestion"),
      };
  }
}
