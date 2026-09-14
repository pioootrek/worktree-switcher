import { createHash } from "node:crypto";
import { constants, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { IdentityError, type AuthenticatedPrincipal, type IdentityService } from "@/server/modules/identity";
import type { KnowledgeProjectSnapshot } from "./contracts";
import { KnowledgeError } from "./knowledge-error";

interface TransferStore {
  schemaVersion(): number;
  exportKnowledgeProject(projectId: string): KnowledgeProjectSnapshot | null;
  importKnowledgeProject(snapshot: KnowledgeProjectSnapshot): void;
}
export interface KnowledgeProjectExportManifest {
  formatVersion: 1; applicationVersion: string; schemaVersion: number; createdAt: string; projectId: string;
  data: { file: "project.json"; size: number; sha256: string };
  attachments: Array<{ file: string; size: number; sha256: string }>;
  counts: Record<string, number>;
}
const MAX_FILES = 1000, MAX_BYTES = 100 * 1024 * 1024;
const hashData = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
function safe(root: string, file: string): string {
  const target=resolve(root,file), base=resolve(root); if(!file||file.startsWith(sep)||target===base||!target.startsWith(base+sep)) throw new KnowledgeError("invalid_request","Export contains an unsafe path.");
  let current=base; for(const part of target.slice(base.length+1).split(sep).slice(0,-1)){current=join(current,part); if(existsSync(current)&&lstatSync(current).isSymbolicLink()) throw new KnowledgeError("invalid_request","Export path contains a symlink.");}
  if(existsSync(base)&&(lstatSync(base).isSymbolicLink()||!lstatSync(base).isDirectory())) throw new KnowledgeError("invalid_request","Export root is unsafe."); return target;
}
function readRegular(path: string): Buffer { const info=lstatSync(path); if(info.isSymbolicLink()||!info.isFile()) throw new KnowledgeError("invalid_request","Export contains an unsafe file."); const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW); try{return readFileSync(fd);} finally{closeSync(fd);} }
function canonical(value: unknown): string { if(Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if(value&&typeof value==="object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value); }
function validateRelations(snapshot: KnowledgeProjectSnapshot): void {
  const ids:Record<string,Set<unknown>>={thread:new Set(snapshot.threads.map(row=>row.id)),reply:new Set(snapshot.replies.map(row=>row.id)),task:new Set(snapshot.tasks.map(row=>row.id)),memory:new Set(snapshot.memories.map(row=>row.id))};
  for(const reply of snapshot.replies) if(!ids.thread.has(reply.thread_id)) throw new KnowledgeError("invalid_request","Reply references a missing thread.");
  for(const relation of snapshot.relations){const source=ids[String(relation.source_kind)],target=ids[String(relation.target_kind)]; if(!source?.has(relation.source_id)||!target?.has(relation.target_id)) throw new KnowledgeError("invalid_request","Relation references a missing record.");}
  for(const attachment of snapshot.attachments) if(!ids[String(attachment.record_kind)]?.has(attachment.record_id)) throw new KnowledgeError("invalid_request","Attachment references a missing record.");
  for(const memory of snapshot.memories){
    const sources=JSON.parse(String(memory.sources_json)) as Array<{kind?:unknown;id?:unknown}>; if(!Array.isArray(sources)) throw new KnowledgeError("invalid_request","Memory sources are invalid.");
    for(const source of sources) if(source.kind!=="external"&&!ids[String(source.kind)]?.has(source.id)) throw new KnowledgeError("invalid_request","Memory references a missing source.");
    if(memory.superseded_by_json){const replacement=JSON.parse(String(memory.superseded_by_json)) as {id?:unknown}; if(!ids.memory.has(replacement.id)) throw new KnowledgeError("invalid_request","Memory replacement is missing.");}
  }
}

export function exportKnowledgeProject(store: TransferStore, identity: Pick<IdentityService,"authorizeKnowledge">, projectId: string, destination: string,
  attachmentDirectory: string, actor: AuthenticatedPrincipal, options: {applicationVersion:string;clock?:()=>string}): KnowledgeProjectExportManifest {
  identity.authorizeKnowledge(actor,projectId,"knowledge:export",{allowArchived:true}); identity.authorizeKnowledge(actor,projectId,"attachments:read",{allowArchived:true});
  if(existsSync(destination)) throw new KnowledgeError("invalid_request","Export destination already exists.");
  const snapshot=store.exportKnowledgeProject(projectId); if(!snapshot) throw new KnowledgeError("not_found","Knowledge project not found.");
  mkdirSync(dirname(destination),{recursive:true}); const staging=mkdtempSync(join(dirname(destination),`.${basename(destination)}.partial-`));
  try {
    const serialized=Buffer.from(canonical(snapshot)); const data={file:"project.json" as const,size:serialized.byteLength,sha256:hashData(serialized)};
    writeFileSync(join(staging,data.file),serialized,{mode:0o600});
    const unique=new Map<string,number>(); for(const row of snapshot.attachments){if(typeof row.sha256!=="string"||typeof row.size!=="number") throw new KnowledgeError("invalid_request","Invalid attachment metadata."); const previous=unique.get(row.sha256); if(previous!==undefined&&previous!==row.size) throw new KnowledgeError("invalid_request","Conflicting attachment metadata."); unique.set(row.sha256,row.size);}
    if(unique.size>MAX_FILES||[...unique.values()].reduce((a,b)=>a+b,0)>MAX_BYTES) throw new KnowledgeError("limit_exceeded","Project export exceeds attachment limits.");
    const attachments=[...unique].sort(([a],[b])=>a.localeCompare(b)).map(([sha256,size])=>{const file=join(sha256.slice(0,2),sha256), source=safe(attachmentDirectory,file), target=safe(join(staging,"attachments"),file); const bytes=readRegular(source); if(bytes.byteLength!==size||hashData(bytes)!==sha256) throw new KnowledgeError("invalid_request","Attachment integrity check failed."); mkdirSync(dirname(target),{recursive:true}); copyFileSync(source,target); return {file,size,sha256};});
    const counts=Object.fromEntries((["threads","replies","tasks","memories","relations","history","attachments"] as const).map(key=>[key,snapshot[key].length]));
    const manifest:KnowledgeProjectExportManifest={formatVersion:1,applicationVersion:options.applicationVersion,schemaVersion:store.schemaVersion(),createdAt:(options.clock??(()=>new Date().toISOString()))(),projectId,data,attachments,counts};
    writeFileSync(join(staging,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600}); renameSync(staging,destination); return manifest;
  } catch(error){rmSync(staging,{recursive:true,force:true}); throw error;}
}

export function importKnowledgeProject(store: TransferStore, source: string, attachmentDirectory: string, actor: AuthenticatedPrincipal): KnowledgeProjectExportManifest {
  if(actor.principalKind!=="owner") throw new IdentityError("owner_authentication_required","Only the active owner can import a knowledge project.");
  const manifest=JSON.parse(readRegular(safe(source,"manifest.json")).toString("utf8")) as KnowledgeProjectExportManifest;
  if(manifest.formatVersion!==1||manifest.schemaVersion>store.schemaVersion()) throw new KnowledgeError("invalid_request","Unsupported knowledge export version.");
  const dataBytes=readRegular(safe(source,manifest.data.file)); if(dataBytes.byteLength!==manifest.data.size||hashData(dataBytes)!==manifest.data.sha256) throw new KnowledgeError("invalid_request","Knowledge export integrity check failed.");
  const snapshot=JSON.parse(dataBytes.toString("utf8")) as KnowledgeProjectSnapshot; if(snapshot.project.id!==manifest.projectId) throw new KnowledgeError("invalid_request","Manifest project ID does not match the snapshot.");
  const arrays=["threads","replies","tasks","memories","relations","history","attachments"] as const; for(const key of arrays) if(!Array.isArray(snapshot[key])||snapshot[key].length!==manifest.counts[key]) throw new KnowledgeError("invalid_request",`Knowledge export count mismatch: ${key}`);
  if(!Array.isArray(snapshot.requiredPrincipals)||snapshot.requiredPrincipals.some(id=>typeof id!=="string")) throw new KnowledgeError("invalid_request","Required principals are invalid."); validateRelations(snapshot);
  if(manifest.attachments.length>MAX_FILES||manifest.attachments.reduce((sum,item)=>sum+item.size,0)>MAX_BYTES) throw new KnowledgeError("limit_exceeded","Knowledge import exceeds attachment limits.");
  const declared=new Map(manifest.attachments.map(item=>[item.sha256,item.size])); const referenced=new Map(snapshot.attachments.map(item=>[String(item.sha256),Number(item.size)])); if(canonical([...declared].sort())!==canonical([...referenced].sort())) throw new KnowledgeError("invalid_request","Attachment manifest does not match project metadata.");
  mkdirSync(dirname(attachmentDirectory),{recursive:true}); const staged=mkdtempSync(join(dirname(attachmentDirectory),".knowledge-import-")); try {
    for(const item of manifest.attachments){if(!/^[a-f0-9]{64}$/.test(item.sha256)||item.file!==join(item.sha256.slice(0,2),item.sha256)) throw new KnowledgeError("invalid_request","Invalid attachment manifest entry."); const bytes=readRegular(safe(join(source,"attachments"),item.file)); if(bytes.byteLength!==item.size||hashData(bytes)!==item.sha256) throw new KnowledgeError("invalid_request","Attachment integrity check failed."); const existing=safe(attachmentDirectory,item.file); if(existsSync(existing)){const current=readRegular(existing); if(current.byteLength!==item.size||hashData(current)!==item.sha256) throw new KnowledgeError("invalid_request","Existing attachment object conflicts with the import."); continue;} const target=safe(staged,item.file); mkdirSync(dirname(target),{recursive:true}); copyFileSync(safe(join(source,"attachments"),item.file),target);}
    for(const item of manifest.attachments){const target=safe(attachmentDirectory,item.file); if(existsSync(target)) continue; mkdirSync(dirname(target),{recursive:true}); renameSync(safe(staged,item.file),target);}
    store.importKnowledgeProject(snapshot);
    return manifest;
  } finally {rmSync(staged,{recursive:true,force:true});}
}
