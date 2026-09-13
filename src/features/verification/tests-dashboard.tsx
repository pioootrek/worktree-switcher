"use client";

import { useId, useRef, useState } from "react";
import { Activity, AlertTriangle, Clock3, ShieldQuestion, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Mutate } from "@/features/control-client";
import { useI18n } from "@/i18n/provider";
import type { ProjectSnapshot } from "@/shared/contracts";
import { TestRunDialog } from "./test-run-dialog";
import { latestTestResults, testDuration, testResults, type TestResult } from "./test-results-model";

const ALL = "__all__";
function sourceState(row: TestResult) {
  if (row.active) return row.freshness;
  if (row.run.source.attribution === "changed") return "changed";
  if (row.freshness === "older") return "older";
  const worktree = row.snapshot.worktrees.find((w) => w.path === row.run.worktreePath);
  if (row.run.source.reasonCodes.includes("dirty_source") || row.run.source.finish?.dirty || row.run.source.preflight?.dirty || worktree?.dirty) return "local";
  return row.freshness;
}

export function TestsDashboard({ snapshots, aggregate, mutate, setError, now }: {
  snapshots: ProjectSnapshot[]; now: number; aggregate: boolean; mutate: Mutate; setError: (message: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState("latest");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(ALL);
  const [worktree, setWorktree] = useState(ALL);
  const [preset, setPreset] = useState(ALL);
  const [result, setResult] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [period, setPeriod] = useState(ALL);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const rows = testResults(snapshots);
  const latest = latestTestResults(rows);
  const active = rows.filter((row) => row.active).sort((a, b) => Number(b.result === "running") - Number(a.result === "running") || (a.run.queuePosition ?? 0) - (b.run.queuePosition ?? 0));
  const selected = rows.find((row) => row.run.id === selectedId);
  const normalized = query.trim().toLowerCase();
  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : null;
  const filtered = (view === "latest" ? latest : rows).filter((row) =>
    (project === ALL || row.snapshot.project.id === project)
    && (worktree === ALL || JSON.stringify([row.snapshot.project.id, row.run.worktreePath]) === worktree)
    && (preset === ALL || row.run.presetId === preset)
    && (result === ALL || result === "active" && row.active || result === "failures" && row.failed || result === row.result)
    && (source === ALL || source === "unverified" && !row.active && row.freshness !== "current" || source === "current" && row.freshness === "current")
    && (!days || Date.parse(row.run.queuedAt) >= now - days * 86400000)
    && `${row.snapshot.project.name} ${row.run.worktreeBranch} ${row.run.worktreePath} ${row.run.presetName} ${row.run.worktreeHead}`.toLowerCase().includes(normalized));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const change = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(0); };
  const metric = (nextView: string, nextResult = ALL, nextSource = ALL) => {
    setView(nextView); setResult(nextResult); setSource(nextSource); setQuery(""); setProject(ALL); setWorktree(ALL); setPreset(ALL); setPeriod(ALL); setPage(0);
  };
  const cancel = async (id: string) => {
    setCancelling(id);
    try { await mutate(`/api/test-runs/${id}/cancel`, {}, t("tests.cancelledNotice")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCancelling(null); }
  };
  const metrics = [
    { label: t("testView.running"), count: active.filter((r) => r.result === "running").length, icon: Activity, action: () => metric("history", "running") },
    { label: t("testView.queued"), count: active.filter((r) => r.result === "queued").length, icon: Clock3, action: () => metric("history", "queued") },
    { label: t("testView.failed"), count: latest.filter((r) => r.failed).length, icon: AlertTriangle, action: () => metric("latest", "failures") },
    { label: t("testView.unverified"), hint: t("testView.outdatedHint"), count: latest.filter((r) => r.freshness !== "current").length, icon: ShieldQuestion, action: () => metric("latest", ALL, "unverified") },
  ];
  const table = (entries: TestResult[]) => <div className="min-w-0 overflow-hidden rounded-lg border">
    <Table className="min-w-[960px]">
      <TableHeader><TableRow>{aggregate ? <TableHead>{t("aggregate.project")}</TableHead> : null}<TableHead>{t("tests.preset")}</TableHead><TableHead>{t("testView.worktree")}</TableHead><TableHead>{t("testView.result")}</TableHead><TableHead>{t("testView.source")}</TableHead><TableHead>{t("testView.date")}</TableHead><TableHead>{t("testView.duration")}</TableHead><TableHead className="text-right">{t("row.actions")}</TableHead></TableRow></TableHeader>
      <TableBody>{entries.map((row) => <TableRow key={row.run.id}>
        {aggregate ? <TableCell className="max-w-36 truncate" title={row.snapshot.project.name}>{row.snapshot.project.name}</TableCell> : null}
        <TableCell className="max-w-52 truncate font-medium" title={row.run.presetName}>{row.run.presetName}</TableCell>
        <TableCell className="max-w-56"><p className="truncate font-mono text-xs" title={row.run.worktreePath}>{row.run.worktreeBranch ?? "detached"}</p><p className="text-xs text-muted-foreground">{row.run.worktreeHead.slice(0, 8)}</p></TableCell>
        <TableCell><Badge variant="outline" className={row.result === "passed" ? "text-success-foreground" : row.failed ? "text-destructive" : "text-muted-foreground"}>{t(`testPhase.${row.result}`)}</Badge>{row.run.queuePosition ? <p className="mt-1 text-xs text-muted-foreground">{t("tests.position", { position: row.run.queuePosition })}</p> : null}</TableCell>
        <TableCell><Badge variant="secondary" className={row.freshness === "current" ? "text-success-foreground" : "text-muted-foreground"}>{t(`testView.source.${sourceState(row)}`)}</Badge></TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(row.run.queuedAt).toLocaleString(locale === "pl" ? "pl-PL" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs">{testDuration(row.run, now)}</TableCell>
        <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" aria-label={t("testView.detailsFor", { name: row.run.presetName, branch: row.run.worktreeBranch ?? "detached" })} onClick={(event) => { returnFocus.current = event.currentTarget; setSelectedId(row.run.id); }}>{t("row.details")}</Button>{row.active ? <Button variant="ghost" size="icon-sm" aria-label={t("tests.cancel")} disabled={cancelling !== null} onClick={() => void cancel(row.run.id)}><Square aria-hidden /></Button> : null}</div></TableCell>
      </TableRow>)}{!entries.length ? <TableRow><TableCell colSpan={aggregate ? 8 : 7} className="h-24 text-center text-muted-foreground">{t("testView.noResults")}</TableCell></TableRow> : null}</TableBody>
    </Table>
  </div>;
  return <section data-tests-dashboard className="min-w-0 space-y-5" aria-label={t("tests.tab")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t("testView.lead")}</p><TestRunDialog snapshots={snapshots} mutate={mutate} setError={setError} /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-test-metrics>{metrics.map(({ label, count, icon: Icon, action, hint }) => {
      const button = <Button variant="ghost" className="h-auto w-full flex-1 flex-col items-start justify-start gap-2 whitespace-normal rounded-[inherit] p-4 text-left" onClick={action}><span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span><span className="text-2xl font-semibold tabular-nums">{count}</span></Button>;
      return <Card key={label} className="gap-0 py-0 shadow-none"><CardContent className="flex flex-1 p-0">{hint ? <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip> : button}</CardContent></Card>;
    })}</div>
    <p className="text-xs text-muted-foreground">{t("testView.scopeHint")} {t("testView.latestHint")}</p>
    <Card className="gap-0 py-4 shadow-none"><CardContent className="space-y-3"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{t("testView.active")}</h3>{active.length > 5 ? <Button variant="ghost" size="sm" onClick={() => metric("history", "active")}>{t("testView.showQueue")} ({active.length})</Button> : null}</div>{active.length ? table(active.slice(0, 5)) : <p className="text-sm text-muted-foreground">{t("testView.noActive")}</p>}</CardContent></Card>
    <Tabs value={view} onValueChange={change(setView)}>
      <TabsList><TabsTrigger value="latest">{t("testView.latest")}</TabsTrigger><TabsTrigger value="history">{t("testView.history")}</TabsTrigger></TabsList>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-60 space-y-2"><Label htmlFor="test-search">{t("testView.search")}</Label><Input id="test-search" type="search" value={query} onChange={(e) => change(setQuery)(e.target.value)} placeholder={t("testView.searchHint")} /></div>
        {aggregate ? <Filter label={t("aggregate.project")} value={project} onChange={(v) => { change(setProject)(v); setWorktree(ALL); }} options={snapshots.map((s) => [s.project.id, s.project.name])} /> : null}
        <Filter label={t("testView.worktree")} value={worktree} onChange={change(setWorktree)} options={[...new Map(rows.filter((r) => project === ALL || r.snapshot.project.id === project).map((r) => [JSON.stringify([r.snapshot.project.id, r.run.worktreePath]), `${aggregate ? r.snapshot.project.name + " · " : ""}${r.run.worktreeBranch ?? r.run.worktreePath}`])).entries()]} />
        <Filter label={t("tests.preset")} value={preset} onChange={change(setPreset)} options={[...new Map(rows.map((r) => [r.run.presetId, r.run.presetName])).entries()]} />
        <Filter label={t("testView.result")} value={result} onChange={change(setResult)} options={["queued", "running", "passed", "failed", "timed_out", "cancelled", "interrupted"].map((v) => [v, t(`testPhase.${v as TestResult["result"]}`)]).concat([["active", t("testView.activeFilter")], ["failures", t("testView.failed")]])} />
        <Filter label={t("testView.sourceFilter")} value={source} onChange={change(setSource)} options={[["current", t("testView.source.current")], ["unverified", t("testView.unverified")]]} />
        <Filter label={t("testView.period")} value={period} onChange={change(setPeriod)} options={(["24h", "7d", "30d"] as const).map((v) => [v, t(`testView.${v}`)])} />
      </div>
      <p className="my-2 text-xs text-muted-foreground">{t("testView.rangeHint")}</p>
      {(["latest", "history"] as const).map((tab) => <TabsContent key={tab} value={tab}>{table(filtered.slice(currentPage * 10, currentPage * 10 + 10))}</TabsContent>)}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground" aria-live="polite">{t("testView.results", { from: filtered.length ? currentPage * 10 + 1 : 0, to: Math.min(filtered.length, currentPage * 10 + 10), count: filtered.length })}</p><nav aria-label={t("testView.resultPages")} className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t("project.previousPage")}</Button><span className="text-xs">{currentPage + 1} / {pages}</span><Button size="sm" variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t("project.nextPage")}</Button></nav></div>
    </Tabs>
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
      <SheetContent closeLabel={t("common.close")} className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        {selected ? <><SheetHeader className="pr-12"><SheetTitle className="break-all">{selected.run.presetName}</SheetTitle><SheetDescription>{t("testView.detailsDescription")}</SheetDescription></SheetHeader><div className="space-y-5 px-4 pb-6">
          <p className="break-all text-sm">{selected.snapshot.project.name} · {selected.run.worktreeBranch ?? "detached"}</p>
          <div className="space-y-2"><p>{t("testView.result")}: <Badge variant="outline" className={selected.failed ? "text-destructive" : selected.result === "passed" ? "text-success-foreground" : ""}>{t(`testPhase.${selected.result}`)}</Badge></p><p>{t("testView.source")}: {t(`testSource.${selected.run.source.attribution}`)}</p><p className="text-sm">{t(`testView.source.${sourceState(selected)}`)}</p><p className="text-xs text-muted-foreground">{t("testView.freshnessNote")}</p></div>
          <div className="space-y-1 break-all font-mono text-xs"><p>{selected.run.worktreePath}</p><p>{selected.run.worktreeHead}</p><p>{t("testView.date")}: {new Date(selected.run.queuedAt).toLocaleString(locale)}</p><p>{t("testView.duration")}: {testDuration(selected.run, now)}</p>{selected.run.exitCode !== null ? <p>{t("tests.exitCode", { code: selected.run.exitCode })}</p> : null}</div>
          {selected.run.error ? <p className={selected.failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{selected.run.error}</p> : null}
          {selected.active ? <Button variant="outline" disabled={cancelling !== null} onClick={() => void cancel(selected.run.id)}><Square aria-hidden />{t("tests.cancel")}</Button> : null}
          <div><h4 className="mb-2 text-sm font-medium">{t("tests.output")}</h4><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{selected.run.logs.join("\n") || "—"}</pre></div>
          <details className="space-y-3"><summary className="cursor-pointer text-sm">{t("project.technicalDetails")}</summary><p>{t("testView.rawPhase")}: {t(`testPhase.${selected.run.phase}`)}</p><p className="break-all font-mono text-xs">{selected.run.executable} {selected.run.args.join(" ")}</p><p className="break-all text-xs">{t("testView.environment")}: {selected.run.environmentProfile} · {selected.run.environmentVariableNames.join(", ")}</p><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(selected.run.source, null, 2)}</pre></details>
        </div></> : null}
      </SheetContent>
    </Sheet>
  </section>;
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  const id = useId();
  const { t } = useI18n();
  return <div className="w-44 max-w-full space-y-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>{t("testView.all")}</SelectItem>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}
