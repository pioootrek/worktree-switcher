import { readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface DirectoryEntry {
  name: string;
  path: string;
}
export interface DirectoryListing {
  root: string;
  current: string;
  parent: string | null;
  directories: DirectoryEntry[];
  files: DirectoryEntry[];
}

export class DirectoryBrowser {
  constructor(private readonly configuredRoot: string) {}

  async list(requestedPath?: string, includeCertificateFiles = false): Promise<DirectoryListing> {
    const root = await realpath(this.configuredRoot);
    const candidate = await realpath(resolve(requestedPath ?? root));
    const relativePath = relative(root, candidate);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error("Nie można przeglądać katalogów poza dozwolonym katalogiem głównym.");
    }

    let entries;
    try {
      entries = await readdir(candidate, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EACCES") throw new Error("Brak uprawnień do odczytu tego katalogu.");
      throw new Error("Nie udało się odczytać katalogu.");
    }

    return {
      root,
      current: candidate,
      parent: candidate === root ? null : dirname(candidate),
      directories: entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, path: resolve(candidate, entry.name) }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
      files: includeCertificateFiles
        ? entries
            .filter((entry) => entry.isFile() && /\.(?:pem|crt|cer|key)$/i.test(entry.name))
            .map((entry) => ({ name: entry.name, path: resolve(candidate, entry.name) }))
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
        : [],
    };
  }
}
