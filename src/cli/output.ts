export interface CliOutputStream {
  isTTY?: boolean;
  write(chunk: string): unknown;
}
export function visibleOutput(
  stdout: CliOutputStream = process.stdout,
  stderr: CliOutputStream = process.stderr,
): CliOutputStream {
  return !stdout.isTTY && stderr.isTTY ? stderr : stdout;
}

export function writeCliLine(message: string): void {
  visibleOutput().write(`${message}\n`);
}
