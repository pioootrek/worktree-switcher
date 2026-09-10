function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function validatePublicControllerBackend(host: string, publicOrigin: string | undefined): void {
  if (!publicOrigin) return;
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || (isIP(normalized) === 4 && normalized.startsWith("127."))) return;
  throw new Error("A public URL requires the controller backend to listen on a loopback host.");
}

export function directControllerOrigin(host: string, port: number): string {
  return new URL(`http://${urlHost(host)}:${port}/`).origin;
}

export function interactiveControllerOrigin(localOrigin: string, publicOrigin: string | undefined): string {
  return publicOrigin ?? localOrigin;
}

export function parsePublicControllerOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The public URL must be an absolute HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The public URL must be an HTTPS origin without credentials, query, fragment, or a non-root path.");
  }
  return url.origin;
}
import { isIP } from "node:net";
