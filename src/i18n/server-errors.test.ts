import { describe, expect, it } from "vitest";

import { localizeServerMessage } from "./server-errors";

describe("server error localization", () => {
  it("keeps Polish errors unchanged", () => {
    expect(localizeServerMessage("Nie znaleziono projektu.", "pl")).toBe("Nie znaleziono projektu.");
  });

  it("translates known and parameterized errors", () => {
    expect(localizeServerMessage("Nie znaleziono projektu.", "en")).toBe("Project not found.");
    expect(localizeServerMessage("Projekt jest zablokowany przez agent:test.", "en"))
      .toBe("The project is locked by agent:test.");
    expect(localizeServerMessage("Wskaż plik: klucz prywatny.", "en"))
      .toBe("Select the private key file.");
    expect(localizeServerMessage("Nie znaleziono manage.py w katalogu głównym worktree.", "en"))
      .toBe("manage.py was not found at the worktree root.");
    expect(localizeServerMessage("Osiągnięto limit 2 uruchomionych serwerów. Aktywne: Web, API.", "en"))
      .toBe("The limit of 2 running servers has been reached. Active: Web, API.");
    expect(localizeServerMessage("Zatrzymaj serwer przed zmianą zmiennych środowiskowych.", "en"))
      .toBe("Stop the server before changing environment variables.");
    expect(localizeServerMessage("Nie znaleziono profilu środowiska.", "en"))
      .toBe("Environment profile not found.");
    expect(localizeServerMessage("Profilu default nie można usunąć.", "en"))
      .toBe("The default profile cannot be deleted.");
    expect(localizeServerMessage("Zmienna PORT jest zarządzana przez kontroler.", "en"))
      .toBe("The PORT variable is managed by the controller.");
  });
});
