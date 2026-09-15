"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import { knowledgeSourceHref as sourceHref } from "@/shared/contracts/knowledge-links";
import type { KnowledgeMemory, KnowledgeSearchHit } from "@/shared/contracts/knowledge-memory";
import type { KnowledgeHistoryEntry, KnowledgePage, KnowledgeInput, KnowledgeOperation } from "@/shared/contracts/knowledge";
import { knowledgeRequest, KnowledgeClientError } from "./knowledge-client";
import { MemoryEditor, knowledgeRetryKey } from "./memory-editor";
import { fieldClass } from "./knowledge-editor";
import type { KnowledgeTab } from "./use-knowledge";

export { knowledgeSourceHref as sourceHref } from "@/shared/contracts/knowledge-links";

type MemoryPanelProps = {
  token: string; principalId: string; projectId: string; recordId: string; writable: boolean; approvable: boolean; changeVersion: number;
  onSelect: (tab: KnowledgeTab, id: string) => void;
};
type MemorySearchState = {
  query: string; tag: string; legacyId: string; kind: KnowledgeSearchHit["kind"] | "";
  status: "active" | "archived" | "superseded" | "open" | "in_progress" | "blocked" | "done" | "";
  inactive: boolean; offset: number;
};

export function MemoryPanel(props: MemoryPanelProps) {
  const [search, setSearch] = useState<MemorySearchState>({ query: "", tag: "", legacyId: "", kind: "memory", status: "", inactive: false, offset: 0 });
  // Search survives selection; pending writes and drafts belong to one record.
  return <MemoryPanelContent key={props.recordId} {...props} search={search} setSearch={setSearch} />;
}

function MemoryPanelContent({ token, principalId, projectId, recordId, writable, approvable, changeVersion, onSelect, search, setSearch }: MemoryPanelProps & {
  search: MemorySearchState; setSearch: (value: MemorySearchState) => void;
}) {
  const { t } = useI18n();
  const { query, tag, legacyId, kind, status, inactive, offset } = search;
  const [page, setPage] = useState<KnowledgePage<KnowledgeSearchHit>>({ items: [], nextOffset: null });
  const [record, setRecord] = useState<KnowledgeMemory | null>(null);
  const [history, setHistory] = useState<KnowledgePage<KnowledgeHistoryEntry>>({ items: [], nextOffset: null });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replacement, setReplacement] = useState("");
  const [pending, setPending] = useState<{ operation: KnowledgeOperation; input: KnowledgeInput<KnowledgeOperation> } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all([
      knowledgeRequest<KnowledgePage<KnowledgeSearchHit>>(token, "search", { projectId, query, offset, includeInactive: inactive, ...(tag ? { tag } : {}), ...(legacyId ? { legacyId } : {}), ...(kind ? { kind } : {}), ...(status ? { status } : {}) }, abort.signal),
      recordId ? knowledgeRequest<KnowledgeMemory>(token, "memory", { projectId, memoryId: recordId }, abort.signal) : Promise.resolve(null),
      recordId ? knowledgeRequest<KnowledgePage<KnowledgeHistoryEntry>>(token, "history", { projectId, recordKind: "memory", recordId, offset: historyOffset }, abort.signal) : Promise.resolve({ items: [], nextOffset: null }),
    ]).then(([rows, memory, entries]) => { if (!abort.signal.aborted) { setPage(rows); setRecord(memory); setHistory(entries); setError(current => current === "knowledge.loadFailed" ? "" : current); } }).catch(() => {
      if (!abort.signal.aborted) { setPage({ items: [], nextOffset: null }); setRecord(null); setHistory({ items: [], nextOffset: null }); setError("knowledge.loadFailed"); }
    });
    return () => abort.abort();
  }, [token, projectId, recordId, query, tag, legacyId, kind, status, inactive, offset, historyOffset, version, changeVersion]);

  const mutate = async (operation: "approve_memory" | "archive_memory" | "restore_memory" | "supersede_memory") => {
    if (!record) return;
    setBusy(true); setError("");
    try {
      let attempt = pending;
      if (!attempt) {
        const common = { projectId, memoryId: record.id, expectedRevision: record.revision, idempotencyKey: knowledgeRetryKey() };
        if (operation === "supersede_memory") {
          const target = await knowledgeRequest<KnowledgeMemory>(token, "memory", { projectId, memoryId: replacement });
          attempt = { operation, input: { ...common, replacementId: target.id, replacementRevision: target.revision } };
        } else attempt = { operation, input: common };
      }
      setPending(attempt);
      await knowledgeRequest(token, attempt.operation, attempt.input);
      setPending(null); setVersion(v => v + 1);
    } catch (error) {
      if (error instanceof KnowledgeClientError && error.status < 500) setPending(null);
      setError(error instanceof KnowledgeClientError && error.failure.code === "revision_conflict" ? "knowledge.conflict" : "knowledge.saveFailed");
      setVersion(v => v + 1);
    } finally { setBusy(false); }
  };
  return <div className="space-y-5">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); setSearch({ query: String(data.get("query") ?? ""), tag: String(data.get("tag") ?? ""), legacyId: String(data.get("legacy") ?? ""), kind: String(data.get("kind")) as typeof kind, status: String(data.get("status") ?? "") as typeof status, inactive: data.has("inactive"), offset: 0 }); setError(""); setVersion(v => v + 1); }}>
      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="memory-query">{t("knowledge.searchContent")}</Label><Input id="memory-query" name="query" defaultValue={query} maxLength={200} /></div>
      <div className="space-y-2"><Label htmlFor="memory-kind">{t("knowledge.sourceKind")}</Label><select id="memory-kind" name="kind" defaultValue={kind} className={fieldClass}><option value="">{t("knowledge.all")}</option>{(["memory", "task", "thread", "reply"] as const).map(value => <option key={value} value={value}>{t(`knowledge.source.${value}`)}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="memory-tag">{t("knowledge.tag")}</Label><Input id="memory-tag" name="tag" defaultValue={tag} maxLength={80} /></div>
      <div className="space-y-2"><Label htmlFor="memory-legacy">{t("knowledge.legacyId")}</Label><Input id="memory-legacy" name="legacy" defaultValue={legacyId} maxLength={160} /></div>
      <div className="space-y-2"><Label htmlFor="memory-status">{t("knowledge.status")}</Label><select id="memory-status" name="status" defaultValue={status} className={fieldClass}><option value="">{t("knowledge.all")}</option>{(["active", "archived", "superseded", "open", "in_progress", "blocked", "done"] as const).map(value => <option key={value} value={value}>{t(`knowledge.${value}`)}</option>)}</select></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" defaultChecked={inactive} />{t("knowledge.includeInactive")}</label>
      <Button type="submit" variant="outline">{t("knowledge.filter")}</Button>
    </form>
    <Button disabled={!writable || busy || Boolean(pending)} onClick={() => setEditor("new")}>{t("knowledge.addMemory")}</Button>
    {error && <p role="alert">{t(error as "knowledge.saveFailed")}</p>}
    {pending && !busy && <Button variant="outline" onClick={() => void mutate(pending!.operation as "approve_memory")}>{t("knowledge.retryOperation")}</Button>}
    {editor && (editor === "new" || record) && <MemoryEditor key={`${projectId}:${editor === "new" ? "new" : recordId}`} token={token} principalId={principalId} projectId={projectId} record={editor === "edit" ? record! : undefined} onClose={() => setEditor(null)} onConflict={() => setVersion(v => v + 1)} onSaved={id => { setEditor(null); setVersion(v => v + 1); onSelect("memory", id); }} />}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
      <div className="space-y-3"><ul className="divide-y divide-border rounded-xl border border-border">{page.items.map(row => <li className="p-3" key={`${row.kind}:${row.id}`}><a className="break-words underline" href={sourceHref(projectId, { kind: row.kind === "reply" ? "thread" : row.kind, id: row.threadId ?? row.id, revision: row.revision })} onClick={event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); setEditor(null); onSelect(row.kind === "memory" ? "memory" : row.kind === "task" ? "backlog" : "discussions", row.threadId ?? row.id);
      }}>{row.title || t("knowledge.source.reply")}</a><p className="text-xs">{row.id} · {t(`knowledge.source.${row.kind}`)}</p><p className="break-words text-sm text-muted-foreground">{row.excerpt}</p></li>)}</ul>
        {!page.items.length && <p>{t("knowledge.empty")}</p>}
        <div className="flex gap-2"><Button variant="outline" disabled={!offset} onClick={() => setSearch({ ...search, offset: Math.max(0, offset - 25) })}>{t("knowledge.previous")}</Button><Button variant="outline" disabled={page.nextOffset === null} onClick={() => setSearch({ ...search, offset: page.nextOffset! })}>{t("knowledge.nextPage")}</Button></div>
      </div>
      {record && <article className="min-w-0 space-y-4 rounded-xl border border-border p-4">
        <h3 className="break-words text-xl font-semibold">{record.title}</h3>
        <p className="break-all text-xs">{record.id} · {t("knowledge.attribution", { author: record.createdBy, revision: record.revision })}</p>
        <p>{t(`knowledge.${record.status}`)} · {t(record.approval?.revision === record.revision ? "knowledge.approved" : record.approval && record.status === "superseded" ? "knowledge.previouslyApproved" : "knowledge.proposed")}</p>
        {record.approval && <p className="break-all text-xs">{t("knowledge.approvedBy", { author: record.approval.principalId, revision: record.approval.revision })}</p>}
        <p className="whitespace-pre-wrap break-words">{record.body}</p>
        <p className="break-words text-sm">{record.tags.join(", ")}{record.legacyId ? ` · ${record.legacyId}` : ""}</p>
        <h4 className="font-medium">{t("knowledge.sources")}</h4><ul className="space-y-2">{record.sources.map((source, index) => <li className="break-all text-sm" key={index}>{source.kind === "repository" ? `${source.sourceId} · ${source.repository} · ${source.commit}:${source.path}` : source.kind === "reply" ? `${source.id} · r${source.revision}` : <a className="underline" href={sourceHref(projectId, source)}>{source.kind === "external" ? source.label : `${source.id} · r${source.revision}`}</a>}</li>)}</ul>
        {record.supersededBy && <a className="block break-all underline" href={sourceHref(projectId, { kind: "memory", ...record.supersededBy })}>{t("knowledge.replacement")}: {record.supersededBy.id} · r{record.supersededBy.revision}</a>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!writable || record.status !== "active" || busy || Boolean(pending)} onClick={() => setEditor("edit")}>{t("knowledge.editMemory")}</Button>
          <Button disabled={!approvable || record.status !== "active" || Boolean(record.approval) || busy || Boolean(pending)} onClick={() => void mutate("approve_memory")}>{t("knowledge.approve")}</Button>
          <Button variant="outline" disabled={!writable || record.status === "superseded" || busy || Boolean(pending)} onClick={() => void mutate(record.status === "archived" ? "restore_memory" : "archive_memory")}>{t(record.status === "archived" ? "knowledge.restoreMemory" : "knowledge.archiveMemory")}</Button>
        </div>
        {record.status === "active" && <div className="space-y-2"><Label htmlFor="memory-replacement">{t("knowledge.replacementId")}</Label><Input id="memory-replacement" value={replacement} onChange={e => setReplacement(e.target.value)} /><Button variant="outline" disabled={!writable || !replacement.trim() || busy || Boolean(pending)} onClick={() => void mutate("supersede_memory")}>{t("knowledge.supersede")}</Button></div>}
        <details><summary>{t("knowledge.history")}</summary><ul className="space-y-2">{history.items.map(entry => <li className="break-all text-xs" key={entry.id}>{entry.operation} · r{entry.revision} · {entry.principalId}<pre className="max-h-40 overflow-auto whitespace-pre-wrap">{entry.previousJson}</pre></li>)}</ul><div className="flex gap-2"><Button variant="outline" disabled={!historyOffset} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 25))}>{t("knowledge.previous")}</Button><Button variant="outline" disabled={history.nextOffset === null} onClick={() => setHistoryOffset(history.nextOffset!)}>{t("knowledge.nextPage")}</Button></div></details>
      </article>}
    </div>
  </div>;
}
