const escape = String.fromCharCode(27);
const csi = new RegExp(`(?:${escape}\\[|${String.fromCharCode(155)})[0-?]*[ -/]*[@-~]`, "g");
const osc = new RegExp(`${escape}\\][\\s\\S]*?(?:${String.fromCharCode(7)}|${escape}\\\\|$)`, "g");

/** Plain text only: no terminal commands, HTML or OSC hyperlinks are rendered. */
export function cleanLogText(text: string) {
  return Array.from(text.replace(osc, "").replace(csi, "")).filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code >= 32 && code !== 127 && !(code >= 128 && code <= 159);
  }).join("");
}

export interface LogMatch { line: number; start: number; end: number }
export function logMatches(lines: string[], query: string, limit = 1000) {
  const matches: LogMatch[] = [];
  if (!query) return { matches, truncated: false };
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  for (const [line, text] of lines.entries()) {
    for (const match of text.matchAll(pattern)) {
      if (matches.length === limit) return { matches, truncated: true };
      matches.push({ line, start: match.index, end: match.index + match[0].length });
    }
  }
  return { matches, truncated: false };
}
