"use client";

import { useEffect, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import type { KnowledgePage } from "@/shared/contracts/knowledge";
import type { KnowledgeAttachment, KnowledgeAttachmentRecordKind } from "@/shared/contracts/knowledge-attachments";
import { knowledgeRequest } from "./knowledge-client";

export function RecordAttachments({ token, projectId, recordId, recordKind, changeVersion }: {
  token: string; projectId: string; recordId: string; recordKind: KnowledgeAttachmentRecordKind; changeVersion: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<KnowledgePage<KnowledgeAttachment> | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void knowledgeRequest<KnowledgePage<KnowledgeAttachment>>(token, "attachments", { projectId, recordId, recordKind, offset }, abort.signal)
      .then(value => { if (!abort.signal.aborted) { setPage(value); setError(false); } })
      .catch(() => { if (!abort.signal.aborted) { setPage(null); setError(true); } });
    return () => abort.abort();
  }, [token, projectId, recordId, recordKind, offset, open, changeVersion]);
  const download = async (attachmentId: string) => {
    setBusy(true);
    try {
      const result = await knowledgeRequest<{ attachment: KnowledgeAttachment; dataBase64: string }>(token, "attachment", { projectId, attachmentId });
      const bytes = Uint8Array.from(atob(result.dataBase64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a"); link.href = url; link.download = result.attachment.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setError(false);
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t border-border pt-4">
    <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}><Paperclip aria-hidden className="size-4" />{t("knowledge.attachments")}</Button>
    {open && <>
      {error && <p role="alert" className="text-sm">{t("knowledge.attachmentsFailed")}</p>}
      {!error && !page && <p role="status">{t("knowledge.loading")}</p>}
      {page && !page.items.length && <p className="text-sm text-muted-foreground">{t("knowledge.noAttachments")}</p>}
      {page?.items.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><span className="min-w-0 break-words text-sm">{item.filename}<span className="block text-xs text-muted-foreground">{Math.ceil(item.size / 1024)} KB</span></span><Button variant="outline" size="sm" disabled={busy} aria-label={`${t("knowledge.downloadAttachment")}: ${item.filename}`} onClick={() => void download(item.id)}><Download aria-hidden className="size-4" />{t("knowledge.downloadAttachment")}</Button></div>)}
      {page && (offset > 0 || page.nextOffset !== null) && <div className="flex gap-2"><Button variant="outline" disabled={!offset} onClick={() => { setPage(null); setOffset(Math.max(0, offset - 25)); }}>{t("knowledge.previous")}</Button><Button variant="outline" disabled={page.nextOffset === null} onClick={() => { setOffset(page.nextOffset!); setPage(null); }}>{t("knowledge.nextPage")}</Button></div>}
    </>}
  </section>;
}
