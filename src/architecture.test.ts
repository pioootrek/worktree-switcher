import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve("src");
const files = readdirSync(root, { recursive: true })
  .filter((file): file is string => typeof file === "string" && /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
  .map((file) => resolve(root, file));
const localName = (file: string) => relative(root, file).replaceAll("\\", "/");
const moduleName = (file: string) => localName(file).match(/^server\/(?:modules|infrastructure)\/[^/]+/)?.[0];

function imports(file: string): string[] {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require")) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return specifiers;
}

function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2))
    : specifier.startsWith(".") ? resolve(dirname(from), specifier) : undefined;
  if (!base) return undefined;
  if (/\.(css|json)$/.test(specifier) && existsSync(base)) return base;
  const target = [base + ".ts", base + ".tsx", resolve(base, "index.ts"), resolve(base, "index.tsx")].find(existsSync);
  if (!target) throw new Error(`Unresolved local import: ${localName(from)} -> ${specifier}`);
  return target;
}

const graph = new Map(files.map((file) => [file, imports(file).map((specifier) => ({ specifier, target: resolveImport(file, specifier) }))]));

describe("codebase boundaries", () => {
  it("keeps browser code and shared contracts independent of privileged code", () => {
    const violations: string[] = [];
    for (const [file, edges] of graph) {
      const name = localName(file);
      const browser = /^(app|features|components|i18n)\//.test(name) && name !== "i18n/server-errors.ts";
      const shared = name.startsWith("shared/");
      for (const { specifier, target } of edges) {
        const targetName = target && localName(target);
        if ((browser || shared) && (isBuiltin(specifier) || specifier === "better-sqlite3" || (targetName && /^(server|cli)\//.test(targetName)))) {
          violations.push(`${name} -> ${specifier}`);
        }
        if (shared && targetName && !targetName.startsWith("shared/")) violations.push(`${name} -> ${specifier}`);
        if (name.startsWith("components/") && targetName?.startsWith("features/")) violations.push(`${name} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("requires imports through the public API of extracted server modules", () => {
    const violations: string[] = [];
    for (const [file, edges] of graph) {
      for (const { target } of edges) {
        if (target && moduleName(target) && moduleName(target) !== moduleName(file) && !target.endsWith("/index.ts")) {
          violations.push(`${localName(file)} -> ${localName(target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps local imports acyclic, including type dependencies", () => {
    const visited = new Set<string>();
    const active: string[] = [];
    const visit = (file: string) => {
      if (active.includes(file)) throw new Error(active.slice(active.indexOf(file)).concat(file).map(localName).join(" -> "));
      if (visited.has(file)) return;
      active.push(file);
      for (const { target } of graph.get(file) ?? []) if (target) visit(target);
      active.pop();
      visited.add(file);
    };
    for (const file of files) visit(file);
  });
});
