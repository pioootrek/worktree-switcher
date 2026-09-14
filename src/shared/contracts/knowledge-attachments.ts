export type KnowledgeAttachmentRecordKind = "thread" | "reply" | "task" | "memory";

export interface KnowledgeAttachment {
  id: string;
  projectId: string;
  recordKind: KnowledgeAttachmentRecordKind;
  recordId: string;
  filename: string;
  mediaType: string;
  size: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeAttachmentDownload {
  attachment: KnowledgeAttachment;
  data: Uint8Array;
  disposition: "attachment";
}
