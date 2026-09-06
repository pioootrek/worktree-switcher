import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ownership comes only from a freshly spawned detached child, never a port or saved PID.
 * Keep it through launcher exit; retire it permanently once the group has no live members.
 */
export class OwnedProcessGroup {
  private retired = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly child: ChildProcess) {}

  async alive(): Promise<boolean> {
    if (this.retired || !this.child.pid) return false;
    if (process.platform === "win32") {
      return this.child.exitCode === null && this.child.signalCode === null;
    }
    try {
      process.kill(-this.child.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      this.retired = true;
      return false;
    }
    // Orphan zombies can remain until init reaps them. They cannot run or hold a port.
    // ps supports this format on both supported platforms (Linux and macOS).
    const { stdout } = await execute("ps", ["-axo", "pgid=,stat="], { timeout: 1_000, maxBuffer: 4 * 1024 * 1024 });
    const live = stdout.split("\n").some((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return Number(group) === this.child.pid && state && !state.startsWith("Z");
    });
    if (!live) this.retired = true;
    return live;
  }

  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopping = this.terminate().finally(() => { this.stopping = null; });
    }
    return this.stopping;
  }

  private async terminate(): Promise<void> {
    if (!await this.alive()) return;
    this.signal("SIGTERM");
    if (await this.waitForExit(3_500)) return;
    this.signal("SIGKILL");
    if (!await this.waitForExit(1_000)) throw new Error("Nie potwierdzono zakończenia zarządzanej grupy procesów.");
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (!await this.alive()) return true;
      await delay(50);
    } while (Date.now() < deadline);
    return !await this.alive();
  }

  private signal(signal: NodeJS.Signals): void {
    if (this.retired || !this.child.pid) return;
    try {
      process.kill(process.platform === "win32" ? this.child.pid : -this.child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      this.retired = true;
    }
  }
}
