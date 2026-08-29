import { spawn } from "node:child_process";

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
  const launch = browserCommand(url);
  if (!launch) {
    console.warn("Nie wykryto sesji graficznej; otwórz wyświetlony link ręcznie.");
    return;
  }
  const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    console.warn(`Nie udało się automatycznie otworzyć przeglądarki: ${error.message}`);
    console.warn("Kontroler nadal działa; otwórz wyświetlony link ręcznie.");
  });
  child.unref();
}
