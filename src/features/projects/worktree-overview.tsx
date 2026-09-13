"use client";

import { useState, useSyncExternalStore } from "react";
import { Clock3, GitBranch, GitMerge, HardDrive, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorktreeRowActions, type WorktreeRowActionsProps } from "./worktree-row-actions";
import { RuntimeBadge } from "@/features/runtime/runtime-badge";
import { useI18n } from "@/i18n/provider";
import type { ProjectSnapshot } from "@/shared/contracts";
import { filterWorktrees, worktreeInsights, worktreeSorts, type WorktreeFilter, type WorktreeSort } from "./worktree-insights";

const SORT_KEY = "worktree-list-sort-v1";
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(SORT_KEY, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(SORT_KEY, notify); };
}
function readSort(): WorktreeSort {
  try { const value = window.localStorage.getItem(SORT_KEY) as WorktreeSort; return worktreeSorts.includes(value) ? value : "launched-desc"; } catch { return "launched-desc"; }
}
function bytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = value > 0 ? Math.min(4, Math.floor(Math.log(value) / Math.log(1024))) : 0;
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function WorktreeOverview({ snapshots, aggregate = false, rowActions, busy, refreshing, onRefresh }: {
  snapshots: ProjectSnapshot[]; aggregate?: boolean;
  rowActions: (snapshot: ProjectSnapshot) => Pick<WorktreeRowActionsProps, "busy" | "pendingPath" | "onOperate" | "onReserve">;
  busy: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const snapshot = snapshots[0];
  const scopeId = aggregate ? "all-projects" : snapshot.project.id;
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorktreeFilter>("all");
  const [page, setPage] = useState(0);
  // Only advances when a dashboard snapshot changes, without an additional polling timer.
  const now = new Date().getTime();
  const rows = snapshots.flatMap((entry) => worktreeInsights(entry, now));
  const sort = useSyncExternalStore(subscribe, readSort, () => "launched-desc" as WorktreeSort);
  const changeSort = (value: WorktreeSort) => {
    try { window.localStorage.setItem(SORT_KEY, value); window.dispatchEvent(new Event(SORT_KEY)); } catch { /* Storage unavailable. */ }
    setPage(0);
  };
  const changeFilter = (value: WorktreeFilter) => { setFilter(value); setPage(0); };
  const results = filterWorktrees(rows, query, filter, sort);
  const pages = Math.max(1, Math.ceil(results.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = results.slice(currentPage * 10, (currentPage + 1) * 10);
  const measured = rows.filter((r) => r.bytes !== null);
  const totalBytes = measured.reduce((sum, row) => sum + row.bytes!, 0);
  const inactive = rows.filter((r) => r.inactive === true).length;
  const merged = rows.filter((r) => r.worktree.merged === true).length;
  const review = rows.filter((r) => r.inactive === true || r.worktree.merged === true).length;
  const unknown = rows.filter((r) => r.inactive === null || r.worktree.merged == null).length;
  const runtimeRow = rows.find((r) => r.running);
  const activeSnapshots = snapshots.filter((entry) => ["running", "starting", "stopping"].includes(entry.runtime.phase));
  const hasRuntime = activeSnapshots.length > 0;
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString(locale === "pl" ? "pl-PL" : "en-GB") : t("overview.unknown");
  const metrics = [
    { label: t(aggregate ? "aggregate.servers" : "overview.server"), value: aggregate && hasRuntime ? String(activeSnapshots.length) : hasRuntime ? runtimeRow?.worktree.branch ?? snapshot.runtime.worktreePath ?? "—" : t("overview.noServer"), icon: Server, hint: aggregate ? t("aggregate.projectCount", { count: snapshots.length }) : t("overview.oneServer"), action: () => { setQuery(""); changeFilter(hasRuntime ? "running" : "all"); } },
    { label: t("overview.worktrees"), value: String(rows.length), icon: GitBranch, hint: t(aggregate ? "projectSwitcher.all" : "overview.allWorktrees"), action: () => { setQuery(""); changeFilter("all"); } },
    { label: t("overview.disk"), value: measured.length ? `${measured.length < rows.length ? "≥ " : ""}${bytes(totalBytes)}` : t("overview.unknown"), icon: HardDrive, hint: t("overview.measured", { count: measured.length, total: rows.length }), action: () => { setQuery(""); changeFilter("all"); changeSort("size-desc"); } },
    { label: t("overview.review"), value: unknown ? `${review}+` : String(review), icon: Clock3, hint: t("overview.reviewCounts", { inactive, merged }), action: () => { setQuery(""); changeFilter("review"); } },
  ];

  return <div data-worktree-overview className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, icon: Icon, hint, action }) => <Card key={label} className="min-w-0 gap-0 py-0 shadow-none">
        <CardContent className="flex flex-1 p-0">
          <Button variant="ghost" className="h-auto w-full flex-1 flex-col items-start justify-start gap-2 whitespace-normal rounded-[inherit] p-4 text-left" onClick={action}>
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span>
            <span className="w-full truncate text-xl font-semibold" title={value}>{value}</span>
            {!aggregate && label === t("overview.server") ? <RuntimeBadge phase={snapshot.runtime.phase} /> : null}
            <span className="text-xs font-normal text-muted-foreground">{hint}</span>
          </Button>
        </CardContent>
      </Card>)}
    </div>
    {aggregate && activeSnapshots.length > 0 ? <div className="flex flex-wrap gap-2" aria-label={t("aggregate.servers")}>
      {activeSnapshots.map((entry) => <Button key={entry.project.id} variant="outline" size="sm" className="h-auto max-w-full whitespace-normal py-2 text-left" onClick={() => { setQuery(entry.project.name); changeFilter("running"); }}>
        <Server aria-hidden /><span className="min-w-0 break-all">{entry.project.name} · {entry.worktrees.find((w) => w.path === entry.runtime.worktreePath)?.branch ?? entry.runtime.worktreePath}</span><RuntimeBadge phase={entry.runtime.phase} />
      </Button>)}
    </div> : null}
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{t("overview.definitions")}{unknown ? ` · ${t("overview.unknownCount", { count: unknown })}` : ""}</summary>
      <p className="mt-2 max-w-4xl leading-relaxed">{t("overview.method")}</p>
      <p className="mt-1">{t("overview.storageMethod")}</p>
      {!aggregate && snapshot.metadata?.lastSuccessfulAt ? <p className="mt-1">{t("metadata.lastSuccess", { time: new Date(snapshot.metadata.lastSuccessfulAt).toLocaleString(locale === "pl" ? "pl-PL" : "en-US") })}</p> : null}
    </details>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64 space-y-2">
        <Label htmlFor={`worktree-search-${scopeId}`}>{t("project.searchWorktrees")}</Label>
        <Input id={`worktree-search-${scopeId}`} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={t("project.searchWorktreesHint")} />
      </div>
      <div className="w-44 max-w-full space-y-2">
        <Label htmlFor={`filter-${scopeId}`}>{t("overview.filter")}</Label>
        <Select value={filter} onValueChange={(v) => changeFilter(v as WorktreeFilter)}>
          <SelectTrigger id={`filter-${scopeId}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{(["all", "running", "review", "inactive", "merged", "unmerged", "both"] as const).map((f) => <SelectItem key={f} value={f}>{t(`overview.filter.${f}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="w-52 max-w-full space-y-2">
        <Label htmlFor={`sort-${scopeId}`}>{t("overview.sort")}</Label>
        <Select value={sort} onValueChange={(v) => changeSort(v as WorktreeSort)}>
          <SelectTrigger id={`sort-${scopeId}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{worktreeSorts.map((s) => <SelectItem key={s} value={s}>{t(`overview.sort.${s}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button variant="outline" size="icon" onClick={onRefresh} disabled={busy || refreshing} aria-label={t("metadata.refresh")}><RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden /></Button>
    </div>
    <div className="rounded-md border border-border" role="region" aria-label={t("project.worktreeTable")} tabIndex={0}>
      <Table className="min-w-[1020px] text-left">
        <TableHeader><TableRow>
          {aggregate ? <TableHead>{t("aggregate.project")}</TableHead> : null}
          <TableHead>{t("project.branch")}</TableHead><TableHead>{t("project.runtimeState")}</TableHead>
          <TableHead>{t("overview.disk")}</TableHead><TableHead>{t("overview.lastLaunch")}</TableHead>
          <TableHead>{t("overview.lastCommit")}</TableHead><TableHead>{t("overview.condition")}</TableHead><TableHead className="text-right">{t("row.actions")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{visible.map(({ snapshot: rowSnapshot, worktree: w, running, bytes: size, lastLaunch, lastCommit, inactive: idle, measuredAt, measurementStatus }) => <TableRow key={JSON.stringify([rowSnapshot.project.id, w.path])} className={running ? "bg-primary/[0.04]" : undefined}>
          {aggregate ? <TableCell className="max-w-40 truncate" title={rowSnapshot.project.name}>{rowSnapshot.project.name}</TableCell> : null}
          <TableCell className="max-w-[320px] py-3"><p className="truncate font-mono font-medium" title={w.branch ?? "detached HEAD"}>{w.branch ?? "detached HEAD"}</p><p className="truncate font-mono text-[11px] text-muted-foreground" title={w.path}>{w.path}</p><span className="font-mono text-[11px] text-muted-foreground">{w.shortHead}</span></TableCell>
          <TableCell>{running ? <RuntimeBadge phase={rowSnapshot.runtime.phase} /> : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className="tabular-nums" title={measuredAt ? `${date(measuredAt)} · ${measurementStatus}` : undefined}>{size === null ? t("overview.unknown") : bytes(size)}</TableCell>
          <TableCell className="text-xs" title={lastLaunch ?? undefined}>{date(lastLaunch)}</TableCell>
          <TableCell className="text-xs" title={lastCommit ?? undefined}>{date(lastCommit)}</TableCell>
          <TableCell><div className="flex max-w-56 flex-wrap gap-1">
            <Badge variant="outline" className={w.dirty ? "text-warning-foreground" : "text-muted-foreground"}>{w.dirty ? t("project.dirty") : t("project.clean")}</Badge>
            {w.isDefaultBranch ? <Badge variant="secondary">{t("overview.defaultBranch")}</Badge> : w.merged === true ? <Badge variant="secondary" title={t("overview.mergedInto", { branch: w.mergedInto ?? "?" })}><GitMerge aria-hidden />{t("overview.filter.merged")}</Badge> : w.merged == null ? <span className="text-xs text-muted-foreground">{t("overview.mergeUnknown")}</span> : null}
            {idle ? <Badge variant="outline"><Clock3 aria-hidden />{t("overview.filter.inactive")}</Badge> : null}
            {w.locked || rowSnapshot.reservation?.worktreePath === w.path ? <Badge variant="outline"><ShieldCheck aria-hidden />{t("overview.reserved")}</Badge> : null}
          </div></TableCell>
          <TableCell className="text-right"><WorktreeRowActions snapshot={rowSnapshot} worktree={w} {...rowActions(rowSnapshot)} /></TableCell>
        </TableRow>)}
        {!visible.length ? <TableRow><TableCell colSpan={aggregate ? 8 : 7} className="h-24 text-center text-muted-foreground">{t("project.noMatchingWorktrees")}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">{t("project.worktreeResults", { from: results.length ? currentPage * 10 + 1 : 0, to: Math.min((currentPage + 1) * 10, results.length), count: results.length, total: rows.length })}</p>
      <nav aria-label={t("project.worktreePagination")} className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t("project.previousPage")}</Button><span className="text-xs tabular-nums">{t("project.worktreePage", { page: currentPage + 1, pages })}</span><Button variant="outline" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t("project.nextPage")}</Button></nav>
    </div>
  </div>;
}
