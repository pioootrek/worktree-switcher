import type { KnowledgeSource } from "./knowledge-memory";

export function knowledgeSourceHref(projectId: string, source: KnowledgeSource, replyThreadId?: string): string {
  if (source.kind === "external") return source.url;
  if (source.kind === "repository") return "";
  const tab = source.kind === "memory" ? "memory" : source.kind === "task" ? "backlog" : "discussions";
  return `?view=knowledge&knowledgeProject=${encodeURIComponent(projectId)}&knowledgeTab=${tab}&record=${encodeURIComponent(replyThreadId ?? source.id)}`;
}
