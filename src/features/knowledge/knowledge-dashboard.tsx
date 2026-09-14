"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/provider";
import type { KnowledgeFilters } from "@/shared/contracts/knowledge";
import { isKnowledgeAccessError, knowledgeIdentity } from "./knowledge-client";
import { KnowledgeEditor, fieldClass, type EditorMode } from "./knowledge-editor";
import { MemoryPanel } from "./memory-panel";
import { TaskContext } from "./task-context";
import { useKnowledge, type KnowledgeTab } from "./use-knowledge";

export function KnowledgeDashboard({ token, setToken, change }: { token: string; setToken: (value: string) => void; change: { version: number; projectIds: string[] } }) {
  const { t } = useI18n();
  const [credential, setCredential] = useState("");
  const [loginError, setLoginError] = useState<"auth" | "load" | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, updateMode] = useState<EditorMode | null>(null);
  const setMode = (next: EditorMode | null) => {
    updateMode(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("knowledgeEditor", next); else url.searchParams.delete("knowledgeEditor");
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get("knowledgeEditor");
      updateMode(value && ["thread", "task", "reply", "from_thread", "edit"].includes(value) ? value as EditorMode : null);
    };
    const timer = setTimeout(sync, 0); window.addEventListener("popstate", sync);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, []);
  const [notice, setNotice] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const model = useKnowledge(token, change);
  const { selection, identity, projects } = model;
  const detail = model.detail?.id === selection.recordId && model.detail.projectId === selection.projectId
    && ((selection.tab === "backlog" && "description" in model.detail) || (selection.tab === "discussions" && "body" in model.detail)) ? model.detail : null;
  const project = model.project?.id === selection.projectId ? model.project : undefined;
  const writable = project?.writable && project.status === "active";
  const close = () => { setMode(null); actionRef.current?.focus(); };
  const navigate = (tab: KnowledgeTab, recordId = "", projectId = selection.projectId) => { close(); setNotice(false); model.select({ tab, recordId, projectId }); };

  if (!token || model.sessionError) return <form className="max-w-xl space-y-4 rounded-xl border border-border p-5" onSubmit={event => {
    event.preventDefault(); setBusy(true); setLoginError(null);
    void knowledgeIdentity(credential).then(() => { setToken(credential); setCredential(""); }).catch(error => setLoginError(isKnowledgeAccessError(error) ? "auth" : "load")).finally(() => setBusy(false));
  }}>
    <h3 className="text-lg font-semibold">{t("knowledge.signIn")}</h3>
    <p className="text-sm text-muted-foreground">{t("knowledge.signInHelp")}</p>
    {(loginError || model.sessionError) && <Alert variant="destructive"><AlertDescription>{t(loginError === "load" ? "knowledge.loadFailed" : "knowledge.sessionExpired")}</AlertDescription></Alert>}
    <Label htmlFor="knowledge-credential">{t("knowledge.credential")}</Label><Input id="knowledge-credential" type="password" value={credential} onChange={event => setCredential(event.target.value)} required autoComplete="off" />
    <Button type="submit" disabled={busy}>{t("knowledge.signIn")}</Button>
  </form>;

  if (!identity) return model.error ? <div className="space-y-3">
    <Alert variant="destructive"><AlertDescription>{t("knowledge.loadFailed")}</AlertDescription></Alert>
    <Button variant="outline" onClick={model.reload}>{t("knowledge.refresh")}</Button>
    <Button variant="ghost" onClick={() => setToken("")}>{t("knowledge.signOut")}</Button>
  </div> : <p role="status">{t("knowledge.loading")}</p>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1"><Label htmlFor="knowledge-project">{t("knowledge.project")}</Label><select id="knowledge-project" className={fieldClass} value={selection.projectId} onChange={event => navigate(selection.tab, "", event.target.value)}>
        {!projects.items.length && <option value="">{t("knowledge.noProjects")}</option>}
        {selection.projectId && !projects.items.some(item => item.id === selection.projectId) && <option value={selection.projectId}>{project?.name ?? t("knowledge.linkedProject")}</option>}
        {projects.items.map(item => <option value={item.id} key={item.id}>{item.name}{item.status === "archived" ? ` · ${t("knowledge.archived")}` : ""}</option>)}
      </select></div>
      <Button variant="outline" onClick={model.reload}>{t("knowledge.refresh")}</Button>
      <Button variant="ghost" onClick={() => { close(); setToken(""); }}>{t("knowledge.signOut")}</Button>
    </div>
    {(model.projectOffset > 0 || projects.nextOffset !== null) && <div className="flex gap-2"><Button variant="outline" disabled={model.projectOffset === 0} onClick={() => model.setProjectOffset(Math.max(0, model.projectOffset - 25))}>{t("knowledge.previousProjects")}</Button><Button variant="outline" disabled={projects.nextOffset === null} onClick={() => model.setProjectOffset(projects.nextOffset!)}>{t("knowledge.nextProjects")}</Button></div>}
    {!projects.items.length && !selection.projectId && <p>{t("knowledge.noProjectsHelp")}</p>}
    <Tabs value={selection.tab} onValueChange={value => navigate(value as KnowledgeTab)}><TabsList aria-label={t("knowledge.title")}><TabsTrigger value="backlog">{t("knowledge.backlog")}</TabsTrigger><TabsTrigger value="discussions">{t("knowledge.discussions")}</TabsTrigger><TabsTrigger value="memory">{t("knowledge.memory")}</TabsTrigger></TabsList></Tabs>
    {notice && <p role="status" className="text-sm">{t("knowledge.saved")}</p>}
    {selection.tab === "memory" ? (selection.projectId ? <MemoryPanel key={`${identity.principal.id}:${selection.projectId}`} token={token} principalId={identity.principal.id} projectId={selection.projectId} recordId={selection.recordId} writable={Boolean(writable)} approvable={identity.principal.kind === "owner" && identity.credential.kind === "owner_session" && project?.status === "active"} changeVersion={change.version + model.refreshVersion} onSelect={navigate} /> : <p>{t("knowledge.noProjectsHelp")}</p>) : selection.projectId && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t(writable ? "knowledge.independent" : "knowledge.readOnly")}</p><Button ref={actionRef} disabled={!writable} onClick={() => { setMode(selection.tab === "discussions" ? "thread" : "task"); setNotice(false); }}>{t("knowledge.quickSave")}</Button></div>
      <form className="flex flex-wrap items-end gap-3" key={`${selection.projectId}:${selection.tab}`} onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        model.setFilters({ query: String(form.get("query") ?? ""), ...(form.get("status") ? { status: String(form.get("status")) as KnowledgeFilters["status"] } : {}), ...(form.get("priority") ? { priority: String(form.get("priority")) as KnowledgeFilters["priority"] } : {}) });
      }}>
        <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1"><Label htmlFor="knowledge-query">{t("knowledge.searchTitle")}</Label><Input id="knowledge-query" name="query" maxLength={200} defaultValue={model.filters.query} /></div>
        {selection.tab === "backlog" && <>
          <div className="space-y-2"><Label htmlFor="knowledge-status">{t("knowledge.status")}</Label><select id="knowledge-status" name="status" className={fieldClass}><option value="">{t("knowledge.all")}</option>{(["open", "in_progress", "blocked", "done", "archived"] as const).map(value => <option key={value} value={value}>{t(`knowledge.${value}`)}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="knowledge-priority">{t("knowledge.priority")}</Label><select id="knowledge-priority" name="priority" className={fieldClass}><option value="">{t("knowledge.all")}</option>{(["now", "next", "later"] as const).map(value => <option key={value} value={value}>{t(`knowledge.${value}`)}</option>)}</select></div>
        </>}
        <Button type="submit" variant="outline">{t("knowledge.filter")}</Button>
      </form>
      {model.error && <Alert variant="destructive"><AlertDescription>{t("knowledge.loadFailed")}</AlertDescription></Alert>}
      {model.loading && <p role="status">{t("knowledge.loading")}</p>}
      {mode && (mode === "task" || mode === "thread" || detail) && <KnowledgeEditor key={`${identity.principal.id}:${selection.projectId}:${mode}:${mode === "task" || mode === "thread" ? "new" : selection.recordId}`} token={token} principalId={identity.principal.id} projectId={selection.projectId} mode={mode} record={mode === "thread" || mode === "task" ? undefined : detail ?? undefined} onCancel={close} onConflict={model.reload} onSaved={(recordId, tab) => { close(); setNotice(true); model.select({ ...selection, tab: tab ?? selection.tab, recordId: recordId ?? selection.recordId }); model.reload(); }} />}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-3">
          <ul className="divide-y divide-border rounded-xl border border-border" aria-label={t(selection.tab === "backlog" ? "knowledge.backlog" : "knowledge.discussions")}>
            {model.rows.items.map(row => <li key={row.id} className="p-3"><a className="block break-words rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-current={row.id === selection.recordId ? "true" : undefined} href={`?view=knowledge&knowledgeProject=${encodeURIComponent(selection.projectId)}&knowledgeTab=${selection.tab}&record=${encodeURIComponent(row.id)}`} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(selection.tab, row.id); }}>{row.title}</a>{"status" in row && <div className="mt-2 flex gap-2"><Badge variant="outline">{t(`knowledge.${row.status}`)}</Badge><span className="text-xs text-muted-foreground">{t(`knowledge.${row.priority}`)}</span></div>}</li>)}
          </ul>
          {!model.loading && !model.error && model.rows.items.length === 0 && <p className="text-sm text-muted-foreground">{t("knowledge.empty")}</p>}
          <div className="flex gap-2"><Button variant="outline" disabled={model.offset === 0 || model.loading} onClick={() => model.setOffset(Math.max(0, model.offset - 25))}>{t("knowledge.previous")}</Button><Button variant="outline" disabled={model.rows.nextOffset === null || model.loading} onClick={() => model.setOffset(model.rows.nextOffset!)}>{t("knowledge.nextPage")}</Button></div>
        </div>
        <div className="min-w-0 space-y-5">
          {detail ? <article className="space-y-4 rounded-xl border border-border p-5">
            <h3 className="break-words text-xl font-semibold">{detail.title}</h3>
            <p className="break-all text-xs text-muted-foreground">{t("knowledge.attribution", { author: detail.createdBy, revision: detail.revision })}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{"description" in detail ? detail.description : detail.body}</p>
            <div className="flex flex-wrap gap-2">{"description" in detail ? <Button variant="outline" disabled={!writable} onClick={() => setMode("edit")}>{t("knowledge.edit")}</Button> : <><Button variant="outline" disabled={!writable} onClick={() => setMode("reply")}>{t("knowledge.reply")}</Button><Button variant="outline" disabled={!writable} onClick={() => setMode("from_thread")}>{t("knowledge.fromThread")}</Button></>}</div>
            {"description" in detail && <TaskContext key={`${selection.projectId}:${detail.id}`} token={token} projectId={selection.projectId} taskId={detail.id} changeVersion={change.version + detail.revision + model.refreshVersion} />}
            {model.relations.items.length > 0 && <section className="space-y-2" aria-label={t("knowledge.relations")}><h4 className="font-medium">{t("knowledge.relations")}</h4><ul className="space-y-2">{model.relations.items.map(relation => {
              const source = relation.sourceId === detail.id;
              const targetId = source ? relation.targetId : relation.sourceId;
              const targetKind = source ? relation.targetKind : relation.sourceKind;
              if (targetKind === "reply") return <li className="break-all text-sm" key={relation.id}>{targetId}</li>;
              const tab = targetKind === "task" ? "backlog" : "discussions";
              return <li key={relation.id}><a className="break-all text-sm underline underline-offset-4" href={`?view=knowledge&knowledgeProject=${encodeURIComponent(selection.projectId)}&knowledgeTab=${tab}&record=${encodeURIComponent(targetId)}`} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(tab, targetId); }}>{t(targetKind === "task" ? "knowledge.relatedTask" : "knowledge.relatedThread")} · {targetId}</a></li>;
            })}</ul><div className="flex gap-2"><Button variant="outline" disabled={model.relationOffset === 0} onClick={() => model.setRelationOffset(Math.max(0, model.relationOffset - 25))}>{t("knowledge.previous")}</Button><Button variant="outline" disabled={model.relations.nextOffset === null} onClick={() => model.setRelationOffset(model.relations.nextOffset!)}>{t("knowledge.nextPage")}</Button></div></section>}
            {"body" in detail && <section className="space-y-3" aria-label={t("knowledge.replies")}><h4 className="font-medium">{t("knowledge.replies")}</h4>{model.replies.items.map(reply => <div className="border-t border-border pt-3" key={reply.id}><p className="break-all text-xs text-muted-foreground">{t("knowledge.attribution", { author: reply.createdBy, revision: reply.revision })}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{reply.body}</p></div>)}<div className="flex gap-2"><Button variant="outline" disabled={model.replyOffset === 0} onClick={() => model.setReplyOffset(Math.max(0, model.replyOffset - 25))}>{t("knowledge.previousReplies")}</Button><Button variant="outline" disabled={model.replies.nextOffset === null} onClick={() => model.setReplyOffset(model.replies.nextOffset!)}>{t("knowledge.nextReplies")}</Button></div></section>}
          </article> : <p className="py-5 text-sm text-muted-foreground">{t("knowledge.selectRecord")}</p>}
        </div>
      </div>
    </>}
  </div>;
}
