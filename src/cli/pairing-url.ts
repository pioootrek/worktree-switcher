export function pairingUrl(origin: string, token: string, sessionId: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("session", sessionId);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
