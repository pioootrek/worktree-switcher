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
import { AlertTriangle, GitBranch, Languages, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useDashboard } from "./use-dashboard";

export function Dashboard() {
  const { locale, setLocale, t } = useI18n();
  const { data, token, loading, error, notice, mutate, setError, runningCount } = useDashboard();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.26_0.06_260/.32),transparent_34rem)]">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 lg:px-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl border border-indigo-400/25 bg-indigo-400/10 shadow-[0_0_30px_oklch(0.65_0.15_270/.12)]">
              <GitBranch className="size-5 text-indigo-300" aria-hidden />
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t("dashboard.tagline")}</p>
              <h1 className="text-2xl font-semibold tracking-tight">Worktree Switcher</h1>
            </div>
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
          <section className="grid gap-5 xl:grid-cols-2" aria-label={t("dashboard.projects")}>
            {data.projects.map((snapshot) => (
              <ProjectCard key={snapshot.project.id} snapshot={snapshot} mutate={mutate} setError={setError} token={token} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
