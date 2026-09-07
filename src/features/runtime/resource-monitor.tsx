"use client";

import { useI18n } from "@/i18n/provider";
import type { RuntimeResourceMetrics } from "@/shared/contracts";
import { MemoryStick } from "lucide-react";

import { Metric } from "@/components/metric";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function ResourceMonitor({ resources }: { resources: RuntimeResourceMetrics }) {
  const { locale, t } = useI18n();
  const history = resources.history ?? [];
  const values = history.map(({ rssBytes }) => rssBytes);
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const range = Math.max(1, maximum - minimum);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 30 - ((value - minimum) / range) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const warning = resources.currentRssBytes !== null
    && resources.warningThresholdBytes !== null
    && resources.currentRssBytes >= resources.warningThresholdBytes;
  const sampleAge = resources.sampleAgeSeconds;

  return (
    <section className={`mt-4 rounded-lg border p-3 ${warning ? "border-amber-400/30 bg-amber-400/5" : "border-white/7 bg-black/10"}`} aria-label={t("resources.title")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><MemoryStick className="size-4 text-indigo-300" aria-hidden />{t("resources.title")}</div>
        <span className="text-xs text-muted-foreground">
          {resources.status === "available" && sampleAge !== null
            ? t("resources.sampleAge", { seconds: sampleAge })
            : t(`resources.status.${resources.status}`)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label={t("resources.memoryNow")} value={formatBytes(resources.currentRssBytes)} mono />
        <Metric label={t("resources.memoryPeak")} value={formatBytes(resources.peakRssBytes)} mono />
        <Metric label={t("resources.cpu")} value={resources.cpuPercent === null ? "—" : `${resources.cpuPercent.toLocaleString(locale === "pl" ? "pl-PL" : "en-US", { maximumFractionDigits: 1 })}%`} mono />
        <Metric label={t("resources.processes")} value={resources.processCount === null ? "—" : String(resources.processCount)} mono />
      </div>
      {points && (
        <svg className="mt-3 h-9 w-full text-indigo-300" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={t("resources.memoryHistory")}>
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {warning && <p className="mt-2 text-xs text-amber-300">{t("resources.warning", { threshold: formatBytes(resources.warningThresholdBytes) })}</p>}
    </section>
  );
}
