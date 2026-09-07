"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/provider";
import type { ProjectView, RuntimePhase } from "@/shared/contracts";
import { LoaderCircle, Variable } from "lucide-react";
import { FormEvent, useState } from "react";

import type { Mutate } from "@/features/control-client";

export function EnvironmentSettingsDialog({
  project,
  phase,
  mutate,
  setError,
}: {
  project: ProjectView;
  phase: RuntimePhase;
  mutate: Mutate;
  setError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [profileName, setProfileName] = useState(project.selectedEnvironmentProfile);
  const [text, setText] = useState(() => Object.entries(project.environment)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n"));
  const [pending, setPending] = useState(false);
  const active = phase === "running" || phase === "starting" || phase === "stopping";

  const parseVariables = () => {
    const environment: Record<string, string> = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error(t("environment.invalidLine", { line: rawLine }));
      environment[line.slice(0, separator).trim()] = line.slice(separator + 1);
    }
    return environment;
  };

  const save = async (event: FormEvent<HTMLFormElement> | null, restart = false) => {
    event?.preventDefault();
    setPending(true);
    try {
      await mutate(
        `/api/projects/${project.id}/environment-profiles`,
        { name: profileName, environment: parseVariables(), restart },
        t("environment.saved", { name: project.name }),
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const selectProfile = (name: string) => {
    const profile = project.environmentProfiles.find((candidate) => candidate.name === name);
    if (!profile) return;
    setProfileName(profile.name);
    setText(Object.entries(profile.environment).map(([key, value]) => `${key}=${value}`).join("\n"));
  };

  const activate = async () => {
    setPending(true);
    try {
      await mutate(
        `/api/projects/${project.id}/environment-profile-selection`,
        { name: profileName, restart: active },
        t("environment.selected", { profile: profileName }),
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("environment.deleteConfirm", { profile: profileName }))) return;
    setPending(true);
    try {
      await mutate(
        `/api/projects/${project.id}/environment-profiles`,
        { name: profileName },
        t("environment.deleted", { profile: profileName }),
        "DELETE",
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) {
        setProfileName(project.selectedEnvironmentProfile);
        setText(Object.entries(project.environment).map(([name, value]) => `${name}=${value}`).join("\n"));
      }
      setOpen(nextOpen);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={t("environment.settings")} title={t("environment.settings")}>
          <Variable aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("environment.title")}</DialogTitle>
          <DialogDescription>{t("environment.description", { name: project.name })}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`environment-profile-list-${project.id}`}>{t("environment.profile")}</Label>
              <Select value={project.environmentProfiles.some(({ name }) => name === profileName) ? profileName : ""} onValueChange={selectProfile}>
                <SelectTrigger id={`environment-profile-list-${project.id}`} className="w-full"><SelectValue placeholder={t("environment.newProfile")} /></SelectTrigger>
                <SelectContent>{project.environmentProfiles.map((profile) => <SelectItem key={profile.name} value={profile.name}>{profile.name}{profile.name === project.selectedEnvironmentProfile ? ` · ${t("environment.active")}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`environment-profile-name-${project.id}`}>{t("environment.profileName")}</Label>
              <Input id={`environment-profile-name-${project.id}`} value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={40} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`environment-${project.id}`}>{t("environment.variables")}</Label>
            <textarea
              id={`environment-${project.id}`}
              className="min-h-52 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"PLAYWRIGHT_E2E=1\nQA_SHOTS_FROZEN_CLOCK_ISO=2026-08-01T12:00:00.000Z"}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">{t("environment.hint")}</p>
          </div>
          {active && profileName === project.selectedEnvironmentProfile && <p className="text-sm text-amber-300">{t("environment.restartHint")}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {profileName !== "default" && profileName !== project.selectedEnvironmentProfile && project.environmentProfiles.some(({ name }) => name === profileName) && (
              <Button type="button" variant="destructive" onClick={() => void remove()} disabled={pending}>{t("environment.delete")}</Button>
            )}
            {profileName !== project.selectedEnvironmentProfile && project.environmentProfiles.some(({ name }) => name === profileName) && (
              <Button type="button" variant="secondary" onClick={() => void activate()} disabled={pending}>{active ? t("environment.activateRestart") : t("environment.activate")}</Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            {active && profileName === project.selectedEnvironmentProfile ? (
              <Button type="button" onClick={() => void save(null, true)} disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden />}{t("environment.saveRestart")}</Button>
            ) : (
              <Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden />}{t("common.save")}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
