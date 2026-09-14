import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, renameSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { KnowledgeAttachment, KnowledgeAttachmentDownload, KnowledgeAttachmentRecordKind } from "@/shared/contracts/knowledge-attachments";
import type { AuthenticatedPrincipal, IdentityService } from "@/server/modules/identity";
import type { KnowledgeStore } from "./contracts";
import { KnowledgeError } from "./knowledge-error";

export interface AttachmentLimits { fileBytes: number; projectBytes: number }
const DEFAULT_LIMITS: AttachmentLimits = { fileBytes: 10 * 1024 * 1024, projectBytes: 100 * 1024 * 1024 };

export class KnowledgeAttachmentService {
  constructor(private readonly store: KnowledgeStore, private readonly identity: Pick<IdentityService, "authorizeKnowledge">,
    private readonly objectDirectory: string, private readonly limits = DEFAULT_LIMITS,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly id: () => string = randomUUID) {}

  upload(projectId: string, recordKind: KnowledgeAttachmentRecordKind, recordId: string,
    input: { filename: string; mediaType: string; data: Uint8Array; sha256?: string }, actor: AuthenticatedPrincipal): KnowledgeAttachment {
    this.identity.authorizeKnowledge(actor, projectId, "attachments:write");
    if (!input.filename || basename(input.filename) !== input.filename || input.filename === "." || input.filename === ".." || input.filename.includes("\\"))
      throw new KnowledgeError("invalid_request", "Invalid attachment filename.");
    if (input.data.byteLength > this.limits.fileBytes || this.store.attachmentBytesForProject(projectId) + input.data.byteLength > this.limits.projectBytes)
      throw new KnowledgeError("limit_exceeded", "Attachment storage limit exceeded.");
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    if (input.sha256 && input.sha256 !== sha256) throw new KnowledgeError("invalid_request", "Attachment hash does not match its content.");
    const directory = join(this.objectDirectory, sha256.slice(0, 2)); mkdirSync(directory, { recursive: true });
    const destination = join(directory, sha256); const temporary = join(directory, `.${sha256}.${this.id()}.tmp`);
    try {
      const descriptor = openSync(temporary, "wx", 0o600); try { writeFileSync(descriptor, input.data); } finally { closeSync(descriptor); }
      try { renameSync(temporary, destination); } catch (error) { unlinkSync(temporary); if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const attachment: KnowledgeAttachment = { id: this.id(), projectId, recordKind, recordId, filename: input.filename,
        mediaType: input.mediaType || "application/octet-stream", size: input.data.byteLength, sha256, createdBy: actor.principalId, createdAt: this.clock() };
      this.store.saveAttachment(attachment); return attachment;
    } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  }

  list(projectId: string, recordKind: KnowledgeAttachmentRecordKind, recordId: string, actor: AuthenticatedPrincipal) {
    this.identity.authorizeKnowledge(actor, projectId, "attachments:read");
    return this.store.listAttachments(projectId, recordKind, recordId);
  }

  download(projectId: string, attachmentId: string, actor: AuthenticatedPrincipal): KnowledgeAttachmentDownload {
    this.identity.authorizeKnowledge(actor, projectId, "attachments:read");
    const attachment = this.store.getAttachment(projectId, attachmentId);
    if (!attachment) throw new KnowledgeError("not_found", "Attachment not found.");
    const data = readFileSync(join(this.objectDirectory, attachment.sha256.slice(0, 2), attachment.sha256));
    if (data.byteLength !== attachment.size || createHash("sha256").update(data).digest("hex") !== attachment.sha256)
      throw new KnowledgeError("invalid_request", "Attachment integrity check failed.");
    return { attachment, data, disposition: "attachment" };
  }
}
