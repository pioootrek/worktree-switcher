"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeFilters, KnowledgeRelation, KnowledgePage, KnowledgeProjectSummary, KnowledgeReply, KnowledgeTask, KnowledgeTaskSummary, KnowledgeThread, KnowledgeThreadSummary } from "@/shared/contracts/knowledge";
import { isKnowledgeAccessError, knowledgeIdentity, knowledgeRequest, type KnowledgeIdentity } from "./knowledge-client";

export type KnowledgeTab = "backlog" | "discussions" | "memory";
export interface KnowledgeSelection { projectId: string; tab: KnowledgeTab; recordId: string }
const emptyPage = <T,>(): KnowledgePage<T> => ({ items: [], nextOffset: null });

export function useKnowledge(token: string, change: { version: number; projectIds: string[] }) {
  const [identity, setIdentity] = useState<KnowledgeIdentity | null>(null);
  const [project, setProject] = useState<KnowledgeProjectSummary | null>(null);
  const [projects, setProjects] = useState(emptyPage<KnowledgeProjectSummary>);
  const [projectOffset, setProjectOffset] = useState(0);
  const [selection, setSelection] = useState<KnowledgeSelection>({ projectId: "", tab: "backlog", recordId: "" });
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<KnowledgeFilters>({});
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(emptyPage<KnowledgeTaskSummary | KnowledgeThreadSummary>);
  const [detail, setDetail] = useState<KnowledgeTask | KnowledgeThread | null>(null);
  const [replies, setReplies] = useState(emptyPage<KnowledgeReply>);
  const [relations, setRelations] = useState(emptyPage<KnowledgeRelation>);
  const [relationOffset, setRelationOffset] = useState(0);
  const [replyOffset, setReplyOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [revision, setRevision] = useState(0);
  const selectionRef = useRef(selection);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("knowledgeTab");
      setSelection({ projectId: params.get("knowledgeProject") ?? "", tab: tab === "discussions" || tab === "memory" ? tab : "backlog", recordId: params.get("record") ?? "" });
      setReady(true);
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, []);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => {
    if (!change.projectIds.length || change.projectIds.includes(selectionRef.current.projectId)) {
      const timer = setTimeout(reload, 0);
      return () => clearTimeout(timer);
    }
  }, [change, reload]);

  const select = (next: KnowledgeSelection) => {
    setSelection(next); setOffset(0); setReplyOffset(0); setRelationOffset(0); setRelations(emptyPage()); setDetail(null); setRows(emptyPage()); setReplies(emptyPage()); setError(false);
    if (next.projectId !== selection.projectId || next.tab !== selection.tab) setFilters({});
    const url = new URL(window.location.href);
    url.searchParams.set("view", "knowledge");
    url.searchParams.set("knowledgeProject", next.projectId);
    url.searchParams.set("knowledgeTab", next.tab);
    if (next.recordId) url.searchParams.set("record", next.recordId); else url.searchParams.delete("record");
    window.history.pushState(null, "", url);
  };

  useEffect(() => {
    if (!token || !ready) return;
    const abort = new AbortController();
    void Promise.all([
      knowledgeIdentity(token, abort.signal),
      knowledgeRequest<KnowledgePage<KnowledgeProjectSummary>>(token, "projects", { offset: projectOffset }, abort.signal),
    ]).then(([who, page]) => {
      if (abort.signal.aborted) return;
      setIdentity(current => current?.principal.id === who.principal.id ? current : who); setProjects(page); setSessionError(false); setDiscoveryError(false);
      if (!selectionRef.current.projectId && page.items[0]) {
        const projectId = page.items[0].id;
        setSelection(current => ({ ...current, projectId }));
        const url = new URL(window.location.href); url.searchParams.set("knowledgeProject", projectId); window.history.replaceState(null, "", url);
      }
    }).catch(error => {
      if (abort.signal.aborted) return;
      if (isKnowledgeAccessError(error)) {
        setIdentity(null); setProjects(emptyPage()); setProject(null); setDetail(null); setRows(emptyPage()); setReplies(emptyPage()); setRelations(emptyPage()); setSessionError(true);
      } else setDiscoveryError(true);
    });
    return () => abort.abort();
  }, [token, ready, projectOffset, revision]);

  useEffect(() => {
    if (!token || !identity || !selection.projectId) return;
    const abort = new AbortController();
    const timer = setTimeout(() => setLoading(true), 0);
    void (async () => {
      try {
        const projectId = selection.projectId;
        const [page, record, responsePage, selectedProject, relationPage] = await Promise.all([
          selection.tab === "memory" ? Promise.resolve(emptyPage<KnowledgeTaskSummary | KnowledgeThreadSummary>()) : knowledgeRequest<KnowledgePage<KnowledgeTaskSummary | KnowledgeThreadSummary>>(token, selection.tab === "backlog" ? "tasks" : "threads", { projectId, offset, ...(selection.tab === "backlog" ? filters : { query: filters.query }) }, abort.signal),
          selection.recordId && selection.tab !== "memory" ? knowledgeRequest<KnowledgeTask | KnowledgeThread>(token, selection.tab === "backlog" ? "task" : "thread", { projectId, ...(selection.tab === "backlog" ? { taskId: selection.recordId } : { threadId: selection.recordId }) }, abort.signal) : Promise.resolve(null),
          selection.recordId && selection.tab === "discussions" ? knowledgeRequest<KnowledgePage<KnowledgeReply>>(token, "replies", { projectId, threadId: selection.recordId, offset: replyOffset }, abort.signal) : Promise.resolve(emptyPage<KnowledgeReply>()),
          knowledgeRequest<KnowledgeProjectSummary>(token, "project", { projectId }, abort.signal),
          selection.recordId && selection.tab !== "memory" ? knowledgeRequest<KnowledgePage<KnowledgeRelation>>(token, "relations", { projectId, recordKind: selection.tab === "backlog" ? "task" : "thread", recordId: selection.recordId, offset: relationOffset }, abort.signal) : Promise.resolve(emptyPage<KnowledgeRelation>()),
        ]);
        if (abort.signal.aborted) return;
        setRelations(relationPage); setProject(selectedProject); setRows(page); setDetail(record); setReplies(responsePage); setError(false);
      } catch {
        if (!abort.signal.aborted) { setRelations(emptyPage()); setProject(null); setRows(emptyPage()); setDetail(null); setReplies(emptyPage()); setError(true); }
      } finally { if (!abort.signal.aborted) { clearTimeout(timer); setLoading(false); } }
    })();
    return () => { clearTimeout(timer); abort.abort(); };
  }, [token, identity, selection, filters, offset, replyOffset, relationOffset, revision]);

  return { relations, relationOffset, setRelationOffset, identity, project, projects, projectOffset, setProjectOffset, selection, select, filters, setFilters: (value: KnowledgeFilters) => { setFilters(value); setOffset(0); }, offset, setOffset, detail, rows, replies, replyOffset, setReplyOffset, loading, error: error || discoveryError, sessionError, reload };
}
