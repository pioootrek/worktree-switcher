"use client";

import { HardDrive, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/provider";
import type { WorktreeStorageHistoryPoint, WorktreeStorageSnapshot } from "@/shared/contracts";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function pathName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function linePoints(history: WorktreeStorageHistoryPoint[], key: "totalBytes" | "nextBytes", maximum: number): string {
  return history.map((point, index) => {
    const x = history.length <= 1 ? 50 : (index / (history.length - 1)) * 100;
    const y = 32 - (point[key] / maximum) * 28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function WorktreeStoragePanel({
  storage,
  defaultPath,
  refresh,
  deleteCache,
  activeWorktreePath,
  reservedWorktreePath,
}: {
  storage: WorktreeStorageSnapshot[];
  defaultPath: string;
  refresh: (path: string) => Promise<void>;
  deleteCache: (path: string) => Promise<void>;
  activeWorktreePath: string | null;
  reservedWorktreePath: string | null;
}) {
  const { locale, t } = useI18n();
  const [selectedPath, setSelectedPath] = useState(defaultPath || storage[0]?.worktreePath || "");
  const [pending, setPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = storage.find(({ worktreePath }) => worktreePath === selectedPath) ?? storage[0];

  if (!selected) return <p className="py-5 text-sm text-muted-foreground">{t("storage.noWorktrees")}</p>;

  const scanning = selected.status === "pending" || selected.status === "scanning";
  const deleteBlocked = scanning || selected.worktreePath === activeWorktreePath || selected.worktreePath === reservedWorktreePath;
  const maximum = Math.max(...selected.history.flatMap(({ totalBytes, nextBytes }) => [totalBytes, nextBytes]), 1);
  const totalPoints = linePoints(selected.history, "totalBytes", maximum);
  const nextPoints = linePoints(selected.history, "nextBytes", maximum);
  const largest = Math.max(...selected.topDirectories.map(({ bytes }) => bytes), 1);

  const requestRefresh = async () => {
    setPending(true);
    try {
      await refresh(selected.worktreePath);
    } finally {
      setPending(false);
    }
  };

  const requestDelete = async () => {
    setDeletePending(true);
    try {
      await deleteCache(selected.worktreePath);
      setDeleteOpen(false);
    } catch {
      // The dashboard owns the visible operation error.
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("storage.worktree")}</p>
          <Select value={selected.worktreePath} onValueChange={setSelectedPath}>
            <SelectTrigger aria-label={t("storage.worktree")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {storage.map((entry) => <SelectItem key={entry.worktreePath} value={entry.worktreePath}>{pathName(entry.worktreePath)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void requestRefresh()} disabled={pending || scanning}>
            {pending || scanning ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}
            {t("storage.refresh")}
          </Button>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deleteBlocked}><Trash2 aria-hidden />{t("storage.deleteNext")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("storage.deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("storage.deleteDescription", { worktree: pathName(selected.worktreePath) })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletePending}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={deletePending}
                  onClick={(event) => { event.preventDefault(); void requestDelete(); }}
                >
                  {deletePending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />}
                  {t("storage.confirmDelete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {deleteBlocked && (
        <p className="text-xs text-muted-foreground">
          {selected.worktreePath === activeWorktreePath
            ? t("storage.stopBeforeDelete")
            : selected.worktreePath === reservedWorktreePath
              ? t("storage.releaseBeforeDelete")
              : t("storage.waitBeforeDelete")}
        </p>
      )}

      <div className="space-y-1 rounded-lg border border-white/7 bg-black/10 p-3">
        {storage.map((entry) => (
          <Button
            key={entry.worktreePath}
            variant="ghost"
            size="sm"
            onClick={() => setSelectedPath(entry.worktreePath)}
            className={`grid h-auto w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-2 py-1.5 text-left text-xs font-normal ${entry.worktreePath === selected.worktreePath ? "bg-white/5" : ""}`}
          >
            <span className="truncate font-mono" title={entry.worktreePath}>{pathName(entry.worktreePath)}</span>
            <span className="text-muted-foreground">.next {formatBytes(entry.nextBytes)}</span>
            <span className="w-20 text-right font-mono">{formatBytes(entry.totalBytes)}</span>
          </Button>
        ))}
      </div>

      {scanning && !selected.measuredAt ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/7 p-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {selected.status === "scanning" ? t("storage.scanning") : t("storage.queued")}
        </div>
      ) : selected.status === "unmeasured" ? (
        <p className="rounded-lg border border-white/7 p-4 text-sm text-muted-foreground">{t("storage.unmeasured")}</p>
      ) : selected.status === "unavailable" && !selected.measuredAt ? (
        <p className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{t("storage.unavailable")}{selected.error ? ` ${selected.error}` : ""}</p>
      ) : (
        <>
          {scanning && selected.measuredAt && <p className="text-xs text-muted-foreground">{t("storage.refreshingPrevious")}</p>}
          {selected.status === "unavailable" && selected.measuredAt && (
            <p className="rounded-md border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">{t("storage.showingPrevious")}</p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <StorageMetric label={t("storage.total")} value={formatBytes(selected.totalBytes)} />
            <StorageMetric label=".next" value={formatBytes(selected.nextBytes)} />
            <StorageMetric label=".next/cache" value={formatBytes(selected.nextCacheBytes)} />
            <StorageMetric label="node_modules" value={formatBytes(selected.nodeModulesBytes)} />
            <StorageMetric label={t("storage.other")} value={formatBytes(selected.otherBytes)} />
          </dl>

          {selected.history.length > 0 && (
            <div className="rounded-lg border border-white/7 bg-black/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2"><HardDrive className="size-3.5" aria-hidden />{t("storage.history")}</span>
                <span>{selected.measuredAt ? new Date(selected.measuredAt).toLocaleString(locale === "pl" ? "pl-PL" : "en-US") : "—"}</span>
              </div>
              <svg className="h-24 w-full" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={t("storage.historyDescription")}>
                <polyline points={totalPoints} fill="none" className="stroke-indigo-300" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                <polyline points={nextPoints} fill="none" className="stroke-amber-300" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span><span className="mr-1 inline-block size-2 rounded-full bg-indigo-300" />{t("storage.total")}</span>
                <span><span className="mr-1 inline-block size-2 rounded-full bg-amber-300" />.next</span>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium">{t("storage.largestDirectories")}</h3>
            {selected.topDirectories.length ? (
              <div className="space-y-2">
                {selected.topDirectories.map((directory) => (
                  <div key={directory.name} className="grid grid-cols-[8rem_minmax(0,1fr)_5rem] items-center gap-2 text-xs">
                    <span className="truncate font-mono" title={directory.name}>{directory.name}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/7"><div className="h-full rounded-full bg-indigo-300/70" style={{ width: `${Math.max(2, (directory.bytes / largest) * 100)}%` }} /></div>
                    <span className="text-right font-mono text-muted-foreground">{formatBytes(directory.bytes)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">{t("storage.noDirectories")}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function StorageMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="pt-0.5 font-mono text-xs">{value}</dd></div>;
}
