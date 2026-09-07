"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/provider";
import type { RuntimePhase } from "@/shared/contracts";
import { Activity, LoaderCircle } from "lucide-react";

export function RuntimeBadge({ phase }: { phase: RuntimePhase }) {
  const { t } = useI18n();
  const active = phase === "running";
  const busy = phase === "starting" || phase === "stopping";
  return (
    <Badge variant="outline" className={active ? "border-emerald-400/25 text-emerald-300" : phase === "failed" ? "border-red-400/25 text-red-300" : "text-muted-foreground"}>
      {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Activity aria-hidden />}
      {t(`phase.${phase}`)}
    </Badge>
  );
}
