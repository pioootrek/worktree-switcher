export interface ServiceStartArgumentsOptions {
  host: string;
  port: number;
  mcpPort: number;
  browseRoot: string;
  dataDirectory: string;
  stateDirectory: string;
  webRoot: string;
  noMcp: boolean;
  memoryWarningMiB: number | null;
  publicOrigin?: string;
}

export function buildServiceStartArguments(options: ServiceStartArgumentsOptions): string[] {
  const arguments_ = [
    "--service-mode", "--no-open",
    "--host", options.host,
    "--port", String(options.port),
    "--mcp-port", String(options.mcpPort),
    "--browse-root", options.browseRoot,
    "--data-dir", options.dataDirectory,
    "--state-dir", options.stateDirectory,
    "--web-root", options.webRoot,
  ];
  if (options.noMcp) arguments_.push("--no-mcp");
  if (options.memoryWarningMiB !== null) arguments_.push("--memory-warning-mib", String(options.memoryWarningMiB));
  if (options.publicOrigin) arguments_.push("--public-url", options.publicOrigin);
  return arguments_;
}
