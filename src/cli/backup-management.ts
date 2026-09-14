import type { AppPaths } from "@/server/paths";
import { acquireControllerLock } from "@/server/controller-lock";
import { createControllerBackup, restoreControllerBackup } from "@/server/controller-backup";
import { SqliteStateStore } from "@/server/sqlite-store";

export async function runBackupCommand(args: string[], paths: AppPaths, applicationVersion: string, write: (line:string)=>void=console.log): Promise<void> {
  const [operation,directory,...extra]=args;
  if (!directory || extra.length || !["create","restore"].includes(operation!)) throw new Error("Usage: backup <create|restore> <directory>");
  const lock=acquireControllerLock(paths.controllerLockPath);
  try {
    if(operation==="create") {
      const store=new SqliteStateStore(paths.databasePath);
      try { const result=await createControllerBackup(store,directory,{applicationVersion,attachmentDirectory:paths.knowledgeAttachmentDirectory}); write(JSON.stringify(result,null,2)); }
      finally { store.close(); }
    } else { restoreControllerBackup(directory,paths.databasePath,paths.knowledgeAttachmentDirectory); write("Backup restored."); }
  } finally { lock.release(); }
}
