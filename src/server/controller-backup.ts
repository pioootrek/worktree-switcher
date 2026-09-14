import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";

export interface ControllerBackupManifest {
  formatVersion: 1;
  applicationVersion: string;
  createdAt: string;
  database: { file: "state.sqlite3"; size: number; sha256: string; schemaVersion: number };
  attachments: Array<{ file: string; size: number; sha256: string }>;
}
interface BackupSource { backup(destination: string): Promise<void>; schemaVersion(): number }
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function filesBelow(root: string, directory=root): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const path=join(directory,entry.name); const stat=lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Backup refuses symbolic links in attachment storage.");
    return stat.isDirectory() ? filesBelow(root,path) : stat.isFile() ? [relative(root,path)] : [];
  });
}
function safe(root: string, file: string): string {
  const target=resolve(root,file); if (!file || file.startsWith(sep) || target===resolve(root) || !target.startsWith(resolve(root)+sep)) throw new Error("Backup manifest contains an unsafe path."); return target;
}

export async function createControllerBackup(source: BackupSource, destination: string, options: {applicationVersion:string;attachmentDirectory:string;clock?:()=>string}): Promise<ControllerBackupManifest> {
  if (existsSync(destination)) throw new Error("Backup destination already exists.");
  const staging=`${destination}.partial`; rmSync(staging,{recursive:true,force:true}); mkdirSync(join(staging,"attachments"),{recursive:true});
  try {
    const databaseFile=join(staging,"state.sqlite3"); await source.backup(databaseFile);
    const attachments=filesBelow(options.attachmentDirectory).sort().map(file=>{
      const from=safe(options.attachmentDirectory,file), to=safe(join(staging,"attachments"),file); mkdirSync(dirname(to),{recursive:true}); copyFileSync(from,to);
      return {file,size:lstatSync(to).size,sha256:hash(to)};
    });
    const manifest: ControllerBackupManifest={formatVersion:1,applicationVersion:options.applicationVersion,createdAt:(options.clock??(()=>new Date().toISOString()))(),database:{file:"state.sqlite3",size:lstatSync(databaseFile).size,sha256:hash(databaseFile),schemaVersion:source.schemaVersion()},attachments};
    writeFileSync(join(staging,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600}); renameSync(staging,destination); return manifest;
  } catch(error) { rmSync(staging,{recursive:true,force:true}); throw error; }
}

export function restoreControllerBackup(source: string, databasePath: string, attachmentDirectory?: string): void {
  const manifest=JSON.parse(readFileSync(join(source,"manifest.json"),"utf8")) as ControllerBackupManifest;
  if (manifest.formatVersion!==1) throw new Error("Unsupported backup format version.");
  const databaseFile=safe(source,manifest.database.file);
  if (lstatSync(databaseFile).size!==manifest.database.size || hash(databaseFile)!==manifest.database.sha256) throw new Error("Backup database integrity check failed.");
  for (const entry of manifest.attachments) { const file=safe(join(source,"attachments"),entry.file); if (!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size!==entry.size||hash(file)!==entry.sha256) throw new Error("Backup attachment integrity check failed."); }
  const check=new Database(databaseFile,{readonly:true,fileMustExist:true}); try { if (check.pragma("integrity_check",{simple:true})!=="ok") throw new Error("SQLite integrity check failed."); } finally { check.close(); }
  mkdirSync(dirname(databasePath),{recursive:true}); const temporary=join(dirname(databasePath),`.${basename(databasePath)}.restore`); copyFileSync(databaseFile,temporary); renameSync(temporary,databasePath);
  if (attachmentDirectory) { const staged=`${attachmentDirectory}.restore`; rmSync(staged,{recursive:true,force:true}); mkdirSync(staged,{recursive:true}); for (const entry of manifest.attachments) { const target=safe(staged,entry.file); mkdirSync(dirname(target),{recursive:true}); copyFileSync(safe(join(source,"attachments"),entry.file),target); } const previous=`${attachmentDirectory}.previous`; rmSync(previous,{recursive:true,force:true}); if(existsSync(attachmentDirectory)) renameSync(attachmentDirectory,previous); renameSync(staged,attachmentDirectory); rmSync(previous,{recursive:true,force:true}); }
}
