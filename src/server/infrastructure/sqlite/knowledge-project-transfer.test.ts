import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityService } from "@/server/modules/identity";
import { exportKnowledgeProject, importKnowledgeProject, KnowledgeAttachmentService, KnowledgeService } from "@/server/modules/knowledge";
import { SqliteStateStore } from "./sqlite-state-store";

const roots:string[]=[]; afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
function fixture(root:string){
  const ids=["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","project-1","thread-1","reply-1","task-1","relation-1","memory-1","attachment-1","temporary-1"];
  let next=0; const id=()=>ids[next++]!; const store=new SqliteStateStore(join(root,"state.sqlite3")); const identity=new IdentityService(store,()=>"2026-09-14T10:00:00.000Z",id,()=>"a".repeat(64));
  const owner=identity.authenticateBearer(identity.bootstrapOwnerSession().token); const project=identity.createKnowledgeProject({name:"Portable"},owner);
  identity.setKnowledgeGrant({principalId:owner.principalId,projectId:project.id,permissions:["knowledge:read","knowledge:write","knowledge:approve","knowledge:export","knowledge:import","attachments:read","attachments:write"]},owner);
  const knowledge=new KnowledgeService(store,identity,()=>"2026-09-14T10:00:00.000Z",id); const thread=knowledge.createThread(project.id,{title:"Decision","body":"Keep knowledge separate."},{idempotencyKey:"thread"},owner).value;
  knowledge.createReply(project.id,thread.id,{body:"Agreed."},{idempotencyKey:"reply"},owner); const task=knowledge.createTaskFromThread(project.id,thread.id,{title:"Implement","description":"Round trip","priority":"now"},{idempotencyKey:"task"},owner).value.task;
  knowledge.execute({operation:"create_memory",input:{projectId:project.id,idempotencyKey:"memory",title:"Boundary",body:"No runtime state",category:"decision",tags:["k5"],legacyId:null,sources:[{kind:"task",id:task.id,revision:task.revision}]}},owner);
  const attachmentDirectory=join(root,"attachments"); new KnowledgeAttachmentService(store,identity,attachmentDirectory,undefined,()=>"2026-09-14T10:00:00.000Z",id).upload(project.id,"task",task.id,{filename:"proof.txt",mediaType:"text/plain",data:Buffer.from("evidence"),idempotencyKey:"attachment"},owner);
  return {store,identity,owner,project,attachmentDirectory};
}

describe("logical knowledge project transfer",()=>{
  it("round-trips one project without runtime state, grants or credentials",()=>{
    const sourceRoot=mkdtempSync(join(tmpdir(),"knowledge-export-source-")),targetRoot=mkdtempSync(join(tmpdir(),"knowledge-export-target-")); roots.push(sourceRoot,targetRoot);
    const source=fixture(sourceRoot), destination=join(sourceRoot,"portable-project"); const manifest=exportKnowledgeProject(source.store,source.identity,source.project.id,destination,source.attachmentDirectory,source.owner,{applicationVersion:"test"});
    expect(manifest.counts).toMatchObject({threads:1,replies:1,tasks:1,memories:1,relations:1,attachments:1});
    const sourceSnapshot=source.store.exportKnowledgeProject(source.project.id); source.store.close();
    let n=0; const ids=["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"]; const targetStore=new SqliteStateStore(join(targetRoot,"state.sqlite3")); const targetIdentity=new IdentityService(targetStore,undefined,()=>ids[n++]!,()=>"a".repeat(64)); const targetOwner=targetIdentity.authenticateBearer(targetIdentity.bootstrapOwnerSession().token);
    importKnowledgeProject(targetStore,destination,join(targetRoot,"attachments"),targetOwner);
    expect(targetStore.exportKnowledgeProject(source.project.id)).toEqual(sourceSnapshot);
    expect(targetStore.listProjects()).toEqual([]); expect(targetStore.listKnowledgeProjectGrants(targetOwner.principalId)).toEqual([]);
    expect(readFileSync(join(targetRoot,"attachments",createHash("sha256").update("evidence").digest("hex").slice(0,2),createHash("sha256").update("evidence").digest("hex")),"utf8")).toBe("evidence");
    targetStore.close();
  });

  it("rejects tampering and a project collision without changing existing knowledge",()=>{
    const root=mkdtempSync(join(tmpdir(),"knowledge-export-invalid-")); roots.push(root); const f=fixture(root), destination=join(root,"export"); exportKnowledgeProject(f.store,f.identity,f.project.id,destination,f.attachmentDirectory,f.owner,{applicationVersion:"test"});
    const data=join(destination,"project.json"), original=readFileSync(data); writeFileSync(data,Buffer.concat([original,Buffer.from(" ")]));
    expect(()=>importKnowledgeProject(f.store,destination,f.attachmentDirectory,f.owner)).toThrowError(expect.objectContaining({code:"invalid_request"}));
    writeFileSync(data,original); expect(()=>importKnowledgeProject(f.store,destination,f.attachmentDirectory,f.owner)).toThrow(/already exists/i); expect(f.store.listThreads(f.project.id,25,0).items).toHaveLength(1); f.store.close();
    expect(existsSync(destination)).toBe(true);
  });
});
