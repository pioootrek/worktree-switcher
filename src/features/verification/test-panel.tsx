"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/provider";
import type { DiscoveredTestPreset, RedactedTestEnvironmentProfile } from "@/shared/contracts";
import { AlertTriangle, LoaderCircle, Play } from "lucide-react";
import { useState } from "react";

import type { Mutate } from "@/features/control-client";

export function TestPanel({
  projectId,
  worktreePath,
  profiles,
  presets,
  discoveryError,
  onQueued,
  mutate,
  setError,
}: {
  projectId: string;
  worktreePath: string;
  profiles: RedactedTestEnvironmentProfile[];
  presets: DiscoveredTestPreset[];
  discoveryError: string | null;
  onQueued: () => void;
  mutate: Mutate;
  setError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const effectivePresetId = presets.some((preset) => preset.id === presetId) ? presetId : presets[0]?.id ?? "";
  const [pending, setPending] = useState(false);
  const selectedPreset = presets.find((preset) => preset.id === effectivePresetId) ?? null;
  const selectedProfile = profiles.find((profile) => profile.name === selectedPreset?.profile) ?? null;

  const assignProfile = async (name: string) => {
    setPending(true);
    try {
      await mutate(`/api/projects/${projectId}/test-preset-profiles`, { presetId: effectivePresetId, name }, t("testProfile.assigned", { profile: name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  };

  const run = async () => {
    setPending(true);
    try {
      await mutate(`/api/projects/${projectId}/tests`, { worktreePath, presetId: effectivePresetId }, t("tests.queuedNotice"));
      onQueued();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-4" aria-label={t("tests.tab")}>
      {discoveryError ? <Alert variant="destructive"><AlertTriangle aria-hidden /><AlertDescription>{discoveryError}</AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={`test-preset-${projectId}`}>{t("tests.preset")}</Label>
          <Select value={effectivePresetId} onValueChange={setPresetId} disabled={pending || presets.length === 0}>
            <SelectTrigger id={`test-preset-${projectId}`} className="w-full"><SelectValue placeholder={t("tests.noPresets")} /></SelectTrigger>
            <SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name} · {preset.adapter}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => void run()} disabled={pending || !effectivePresetId || !worktreePath}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}{t("tests.run")}
        </Button>
      </div>
      {selectedPreset ? (
        <details className="space-y-2 rounded-md border bg-muted/50 p-3"><summary className="cursor-pointer text-sm">{t("testView.advanced")}</summary>
          <Label htmlFor={`test-profile-${projectId}`}>{t("testProfile.label")}</Label>
          <Select value={selectedPreset.profile} onValueChange={(value) => void assignProfile(value)} disabled={pending || profiles.length === 0}>
            <SelectTrigger id={`test-profile-${projectId}`} className="w-full sm:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>{profiles.map((profile) => <SelectItem key={profile.name} value={profile.name}>{profile.name}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {selectedProfile?.policy.mode === "inherit-server-profile"
              ? t("testProfile.inherits", { profile: selectedProfile.policy.serverProfile ?? "" })
              : t("testProfile.clean")}
            {" · "}
            {t("testProfile.nodeEnv", { value: selectedProfile?.nodeEnv ?? "—" })}
            {selectedProfile && selectedProfile.requiredVariables.length > 0
              ? ` · ${t("testProfile.required", { names: selectedProfile.requiredVariables.join(", ") })}`
              : ""}
          </p>
        </details>
      ) : null}
      {presets.length === 0 && !discoveryError ? <p className="text-sm text-muted-foreground">{t("tests.noPresets")}</p> : null}
    </section>
  );
}
