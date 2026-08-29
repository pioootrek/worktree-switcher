export function pairingUrl(host: string, port: number, token: string, sessionId: string): string {
  const url = new URL(`http://${host}:${port}/`);
  url.searchParams.set("session", sessionId);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
