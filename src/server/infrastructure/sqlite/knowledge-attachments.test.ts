import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "./sqlite-state-store";
import { IdentityService } from "@/server/modules/identity";
import { KnowledgeAttachmentService, KnowledgeService } from "@/server/modules/knowledge";

const cleanups: Array<() => void> = []; afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()));
function setup() {
  const root = mkdtempSync(join(tmpdir(), "knowledge-attachment-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new SqliteStateStore(join(root, "state.sqlite3")); cleanups.push(() => store.close());
  const identity = new IdentityService(store); const owner = identity.authenticateBearer(identity.bootstrapOwnerSession().token);
  const project = identity.createKnowledgeProject({ name: "Files" }, owner);
  identity.setKnowledgeGrant({ principalId: owner.principalId, projectId: project.id, permissions: ["attachments:read", "attachments:write"] }, owner);
  return { store, identity, owner, project, service: new KnowledgeAttachmentService(store, identity, join(root, "attachments"), { fileBytes: 12, projectBytes: 20 }, () => "2026-09-14T00:00:00.000Z", (() => { let id=0; return () => `id-${++id}`; })()) };
}
describe("knowledge attachments", () => {
  it("uploads, lists and downloads an immutable attachment through the authorized service", () => {
    const f=setup(); const data=Buffer.from("evidence"); const saved=f.service.upload(f.project.id,"task","task-1",{filename:"proof.txt",mediaType:"text/plain",data},f.owner);
    expect(f.service.list(f.project.id,"task","task-1",f.owner)).toEqual([saved]);
    expect(f.service.download(f.project.id,saved.id,f.owner)).toEqual({attachment:saved,data,disposition:"attachment"});
  });
  it("rejects unsafe names, mismatched hashes and bounded storage", () => {
    const f=setup(); const input={mediaType:"text/plain",data:Buffer.from("evidence")};
    expect(()=>f.service.upload(f.project.id,"task","x",{...input,filename:"../proof"},f.owner)).toThrowError(expect.objectContaining({code:"invalid_request"}));
    expect(()=>f.service.upload(f.project.id,"task","x",{...input,filename:"proof",sha256:"0".repeat(64)},f.owner)).toThrowError(expect.objectContaining({code:"invalid_request"}));
    expect(()=>f.service.upload(f.project.id,"task","x",{...input,filename:"large",data:Buffer.alloc(13)},f.owner)).toThrowError(expect.objectContaining({code:"limit_exceeded"}));
  });
  it("exposes files through the shared transport contract", () => {
    const f=setup(); const api=new KnowledgeService(f.store,f.identity,undefined,undefined,undefined,f.service);
    const saved=api.execute({operation:"create_attachment",input:{projectId:f.project.id,recordKind:"task",recordId:"task-1",filename:"proof.txt",mediaType:"text/plain",dataBase64:"ZXZpZGVuY2U="}},f.owner) as {id:string};
    expect(api.execute({operation:"attachment",input:{projectId:f.project.id,attachmentId:saved.id}},f.owner)).toMatchObject({dataBase64:"ZXZpZGVuY2U=",disposition:"attachment"});
  });
});
