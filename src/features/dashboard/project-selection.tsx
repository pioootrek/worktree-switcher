"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "worktree-switcher-project-selection";
const STORAGE_VERSION = 1;

interface StoredProjectSelection {
  version: typeof STORAGE_VERSION;
  projectId: string;
}

interface ProjectSelectionContextValue {
  selectedProjectId: string | null;
  selectProject: (projectId: string) => void;
}

const ProjectSelectionContext = createContext<ProjectSelectionContextValue | null>(null);
const SELECTION_EVENT = "worktree-switcher-project-selection-change";

function readSelection(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredProjectSelection>;
    return parsed.version === STORAGE_VERSION && typeof parsed.projectId === "string" ? parsed.projectId : null;
  } catch {
    return null;
  }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SELECTION_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SELECTION_EVENT, notify);
  };
}

const getSnapshot = () => readSelection(window.localStorage.getItem(STORAGE_KEY));
const getServerSnapshot = () => null;

export function ProjectSelectionProvider({ children }: { children: ReactNode }) {
  const selectedProjectId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const selectProject = useCallback((projectId: string) => {
    const stored: StoredProjectSelection = { version: STORAGE_VERSION, projectId };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    window.dispatchEvent(new Event(SELECTION_EVENT));
  }, []);

  const value = useMemo(() => ({ selectedProjectId, selectProject }), [selectProject, selectedProjectId]);
  return <ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>;
}

export function useProjectSelection(): ProjectSelectionContextValue {
  const context = useContext(ProjectSelectionContext);
  if (!context) throw new Error("useProjectSelection must be used inside ProjectSelectionProvider");
  return context;
}
