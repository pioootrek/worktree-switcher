"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/features/dashboard/empty-state";
import { ThemeToggle } from "@/features/dashboard/theme-toggle";
import { McpStatusDialog } from "@/features/mcp/mcp-status-dialog";
import { AddProjectDialog } from "@/features/projects/add-project-dialog";
import { ProjectCard } from "@/features/projects/project-card";
import { CapacityDialog } from "@/features/runtime/capacity-dialog";
import { TestQueueDialog } from "@/features/verification/test-queue-dialog";
import { dashboardSummary } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { AlertTriangle, FlaskConical, FolderGit2, GitBranch, HardDrive, Languages, LoaderCircle, Settings2 } from "lucide-react";
import { useState } from "react";
import { useDashboard } from "./use-dashboard";

export function Dashboard() {
  const { locale, setLocale, t } = useI18n();
  const { data, token, loading, error, notice, mutate, setError, runningCount } = useDashboard();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[100px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-sidebar lg:flex lg:min-h-screen lg:flex-col lg:items-center">
        <div className="grid h-20 w-full place-items-center border-b border-border">
          <div className="flex flex-col items-center text-primary">
            <GitBranch className="size-6" aria-hidden />
            <span className="mt-0.5 text-lg font-semibold tracking-tight">WS</span>
          </div>
        </div>
        <nav className="flex w-full flex-1 flex-col gap-2 py-8" aria-label={t("dashboard.navigation")}>
          <a href="#projects" className="relative flex min-h-20 flex-col items-center justify-center gap-2 bg-sidebar-accent text-xs font-medium text-primary before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-r-full before:bg-primary">
            <FolderGit2 className="size-5" aria-hidden />{t("dashboard.navProjects")}
          </a>
          <span className="flex min-h-20 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <FlaskConical className="size-5" aria-hidden />{t("dashboard.navTests")}
          </span>
          <span className="flex min-h-20 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="size-5" aria-hidden />{t("dashboard.navResources")}
          </span>
        </nav>
        <div className="flex w-full flex-col items-center gap-3 border-t border-border py-5 text-xs text-muted-foreground">
          <Settings2 className="size-5" aria-hidden />{t("dashboard.navSettings")}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="z-30 flex min-h-16 flex-wrap items-center justify-between gap-4 border-b border-border bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-7 lg:sticky lg:top-0 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-2 text-primary lg:hidden"><GitBranch className="size-5" aria-hidden /><span className="font-semibold">WS</span></div>
            <span className="hidden text-sm text-muted-foreground sm:inline">{t("dashboard.navProjects")}</span>
            <span className="hidden text-muted-foreground/50 sm:inline">/</span>
            <h1 className="truncate text-sm font-medium">Worktree Switcher</h1>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-9 gap-2 px-3 font-normal">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              {dashboardSummary(locale, runningCount, data.projects.length)}
            </Badge>
            <CapacityDialog status={data.capacity} mutate={mutate} setError={setError} />
            <TestQueueDialog status={data.testQueue} mutate={mutate} setError={setError} />
            <McpStatusDialog status={data.mcp} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocale(locale === "pl" ? "en" : "pl")}
              aria-label={t("language.label")}
              title={t("language.label")}
            >
              <Languages aria-hidden />{locale === "pl" ? "EN" : "PL"}
            </Button>
            <ThemeToggle />
            <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} mutate={mutate} token={token} />
          </div>
        </header>

        <div className="mx-auto max-w-[1460px] px-4 py-7 sm:px-7 lg:px-8 lg:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{t("dashboard.tagline")}</p>
              <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{t("dashboard.projects")}</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">{t("dashboard.projectLead")}</p>
          </div>

        <div className="sr-only" aria-live="polite">{error ?? notice}</div>
        {error && (
          <Alert variant="destructive" className="mb-5">
            <AlertTriangle aria-hidden />
            <AlertTitle>{t("dashboard.operationError")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="grid place-items-center py-28 text-muted-foreground">
            <LoaderCircle className="mb-3 size-6 animate-spin motion-reduce:animate-none" aria-hidden />
            {t("dashboard.connecting")}
          </div>
        ) : data.projects.length === 0 ? (
          <EmptyState onAdd={() => setDialogOpen(true)} />
        ) : (
          <section id="projects" className="grid gap-7" aria-label={t("dashboard.projects")}>
            {data.projects.map((snapshot) => (
              <ProjectCard key={snapshot.project.id} snapshot={snapshot} mutate={mutate} setError={setError} token={token} />
            ))}
          </section>
        )}
        </div>
        <footer className="flex min-h-14 items-center justify-end border-t border-border px-4 text-xs text-muted-foreground sm:px-7 lg:px-8">
          Worktree Switcher
        </footer>
      </div>
    </main>
  );
}
