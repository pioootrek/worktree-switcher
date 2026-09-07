"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DirectoryPicker } from "@/features/projects/directory-picker";
import { useI18n } from "@/i18n/provider";
import type { LaunchPreset } from "@/shared/contracts";
import { LoaderCircle, Plus } from "lucide-react";
import { FormEvent, useState } from "react";

import type { Mutate } from "@/features/control-client";

export function AddProjectDialog({ open, onOpenChange, mutate, token }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mutate: Mutate;
  token: string;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [repositoryPath, setRepositoryPath] = useState("");
  const [launchPreset, setLaunchPreset] = useState<LaunchPreset>("auto");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFormError(null);
    try {
      await mutate("/api/projects", {
        name: String(form.get("name") ?? ""),
        repositoryPath: String(form.get("repositoryPath") ?? ""),
        port: Number(form.get("port")),
        launchPreset,
      }, t("add.success"));
      setRepositoryPath("");
      setLaunchPreset("auto");
      onOpenChange(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button><Plus aria-hidden />{t("add.trigger")}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
          <DialogDescription>{t("add.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2"><Label htmlFor="name">{t("add.name")}</Label><Input id="name" name="name" placeholder="Frontend" required maxLength={80} /></div>
          <div className="space-y-2">
            <Label htmlFor="repositoryPath">{t("add.repositoryPath")}</Label>
            <DirectoryPicker token={token} value={repositoryPath} onChange={setRepositoryPath} />
          </div>
          <div className="space-y-2"><Label htmlFor="port">{t("add.port")}</Label><Input id="port" name="port" type="number" defaultValue="3000" min="1024" max="65535" required /></div>
          <div className="space-y-2">
            <Label htmlFor="launch-preset">{t("add.preset")}</Label>
            <Select value={launchPreset} onValueChange={(value) => setLaunchPreset(value as LaunchPreset)}>
              <SelectTrigger id="launch-preset" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("preset.auto")}</SelectItem>
                <SelectItem value="node">{t("preset.node")}</SelectItem>
                <SelectItem value="django">{t("preset.django")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t("add.commandHint")}</p>
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden />}{t("add.submit")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
