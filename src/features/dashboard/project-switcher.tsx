"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/provider";
import type { ProjectView } from "@/shared/contracts";
import { Check, ChevronsUpDown, FolderGit2, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useId, useMemo, useState } from "react";

const PROJECT_LIST_ID = "global-project-switcher-list";

interface ProjectSwitcherProps {
  projects: ProjectView[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectSwitcher({ projects, selectedProjectId, onSelect }: ProjectSwitcherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelId = useId();
  const valueId = useId();
  const selected = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => `${project.name} ${project.repositoryPath}`.toLocaleLowerCase().includes(normalized));
  }, [projects, query]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-controls={PROJECT_LIST_ID}
          aria-labelledby={`${labelId} ${valueId}`}
          className="h-10 min-w-0 max-w-[min(24rem,calc(100vw-9rem))] justify-start gap-2 rounded-md px-2 text-left hover:bg-accent/70 sm:px-3"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <FolderGit2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span id={labelId} className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("projectSwitcher.label")}</span>
            <span id={valueId} className="block truncate text-sm font-semibold">{selected?.name ?? t("projectSwitcher.none")}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("projectSwitcher.search")}
              aria-label={t("projectSwitcher.search")}
              aria-controls={PROJECT_LIST_ID}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown") return;
                event.preventDefault();
                document.querySelector<HTMLButtonElement>(`#${PROJECT_LIST_ID} [role="option"]`)?.focus();
              }}
              className="h-10 pl-9"
            />
          </div>
          <div id={PROJECT_LIST_ID} role="listbox" aria-label={t("projectSwitcher.projects")} className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("projectSwitcher.noResults")}</p>
            ) : filtered.map((project) => {
              const active = project.id === selected?.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onSelect(project.id); setOpen(false); }}
                  onKeyDown={(event) => {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const options = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
                    const current = options.indexOf(event.currentTarget);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown"
                      ? Math.min(current + 1, options.length - 1)
                      : Math.max(current - 1, 0);
                    options[next]?.focus();
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted/60 text-muted-foreground">
                    <FolderGit2 className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{project.repositoryPath}</span>
                  </span>
                  <Check className={active ? "size-4 text-primary" : "size-4 opacity-0"} aria-hidden />
                </button>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
