import { spawn } from "node:child_process";

import { systemLocale, translate } from "../i18n/messages";

export interface BrowserCommand {
  command: string;
  args: string[];
}

export function browserCommand(
  url: string,
  platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BrowserCommand | null {
  if (platform === "linux" && !environment.DISPLAY && !environment.WAYLAND_DISPLAY) return null;
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string): void {
  const locale = systemLocale(process.env);
  const launch = browserCommand(url);
  if (!launch) {
    console.warn(translate(locale, "cli.noGui"));
    return;
  }
  const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    console.warn(translate(locale, "cli.openFailed", { error: error.message }));
    console.warn(translate(locale, "cli.controllerContinues"));
  });
  child.unref();
}
