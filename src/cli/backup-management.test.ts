import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveAppPaths } from "@/server/paths";
import { SqliteStateStore } from "@/server/sqlite-store";
import { runBackupCommand } from "./backup-management";
const roots:string[]=[]; afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
it("creates and restores a controller backup through the offline owner CLI seam",async()=>{
  const root=mkdtempSync(join(tmpdir(),"backup-cli-")); roots.push(root); const paths=resolveAppPaths(join(root,"data"),join(root,"state"));
  const store=new SqliteStateStore(paths.databasePath); store.addProject({name:"Kept",repositoryPath:join(root,"repo"),port:4567,executable:"pnpm",args:["dev"]}); store.close();
  const backup=join(root,"backup"); await runBackupCommand(["create",backup],paths,"test",()=>{});
  const changed=new SqliteStateStore(paths.databasePath); changed.removeProject(changed.listProjects()[0]!.id,"test"); changed.close();
  await runBackupCommand(["restore",backup],paths,"test",()=>{});
  const restored=new SqliteStateStore(paths.databasePath); expect(restored.listProjects()[0]?.name).toBe("Kept"); restored.close();
});
