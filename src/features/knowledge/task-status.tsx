import { Circle, CircleCheck, CircleDashed, CirclePause, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/provider";
import type { KnowledgeTaskStatus, KnowledgeTaskPriority } from "@/shared/contracts/knowledge";

const icons = { open: Circle, in_progress: CircleDashed, blocked: CirclePause, done: CircleCheck, archived: Archive };
export function TaskStatus({ status, priority }: { status: KnowledgeTaskStatus; priority: KnowledgeTaskPriority }) {
  const { t } = useI18n();
  const Icon = icons[status];
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <Badge variant="outline" className={status === "blocked" ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : status === "in_progress" ? "border-primary/40 text-foreground" : "text-muted-foreground"}><Icon aria-hidden className="size-3.5" />{t(`knowledge.${status}`)}</Badge>
    <span className={priority === "now" ? "font-semibold text-foreground" : "text-muted-foreground"}>{t(`knowledge.${priority}`)}</span>
  </div>;
}
