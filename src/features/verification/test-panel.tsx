"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/provider";
import type { DiscoveredTestPreset, RedactedTestEnvironmentProfile, TestRun } from "@/shared/contracts";
import { Activity, AlertTriangle, LoaderCircle, Play, Square } from "lucide-react";
import { useState } from "react";

import type { Mutate } from "@/features/control-client";

export function TestPanel({
  projectId,
  worktreePath,
  profiles,
  presets,
  discoveryError,
  runs,
  mutate,
  setError,
}: {
  projectId: string;
  worktreePath: string;
  profiles: RedactedTestEnvironmentProfile[];
  presets: DiscoveredTestPreset[];
  discoveryError: string | null;
  runs: TestRun[];
  mutate: Mutate;
  setError: (message: string | null) => void;
}) {
  const { locale, t } = useI18n();
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const effectivePresetId = presets.some((preset) => preset.id === presetId) ? presetId : presets[0]?.id ?? "";
  const [pending, setPending] = useState(false);
  const selectedPreset = presets.find((preset) => preset.id === effectivePresetId) ?? null;
  const selectedProfile = profiles.find((profile) => profile.name === selectedPreset?.profile) ?? null;

  const assignProfile = async (name: string) => {
    try {
      await mutate(`/api/projects/${projectId}/test-preset-profiles`, { presetId: effectivePresetId, name }, t("testProfile.assigned", { profile: name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const run = async () => {
    setPending(true);
    try {
      await mutate(`/api/projects/${projectId}/tests`, { worktreePath, presetId: effectivePresetId }, t("tests.queuedNotice"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const cancel = async (runId: string) => {
    try {
      await mutate(`/api/test-runs/${runId}/cancel`, {}, t("tests.cancelledNotice"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="space-y-4" aria-label={t("tests.tab")}>
      {discoveryError ? <Alert variant="destructive"><AlertTriangle aria-hidden /><AlertDescription>{discoveryError}</AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={`test-preset-${projectId}`}>{t("tests.preset")}</Label>
          <Select value={effectivePresetId} onValueChange={setPresetId} disabled={presets.length === 0}>
            <SelectTrigger id={`test-preset-${projectId}`} className="w-full"><SelectValue placeholder={t("tests.noPresets")} /></SelectTrigger>
            <SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name} · {preset.adapter}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => void run()} disabled={pending || !effectivePresetId || !worktreePath}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}{t("tests.run")}
        </Button>
      </div>
      {selectedPreset ? (
        <div className="space-y-2 rounded-md border bg-black/15 p-3">
          <Label htmlFor={`test-profile-${projectId}`}>{t("testProfile.label")}</Label>
          <Select value={selectedPreset.profile} onValueChange={(value) => void assignProfile(value)} disabled={profiles.length === 0}>
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
        </div>
      ) : null}
      {presets.length === 0 && !discoveryError ? <p className="text-sm text-muted-foreground">{t("tests.noPresets")}</p> : null}
      <div>
        <h3 className="mb-2 text-sm font-medium">{t("tests.history")}</h3>
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("tests.noRuns")}</p> : (
          <div className="space-y-2">
            {runs.map((testRun) => {
              const active = testRun.phase === "queued" || testRun.phase === "running";
              return (
                <div key={testRun.id} className="rounded-md border bg-black/15 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{testRun.presetName}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground" title={testRun.worktreePath}>
                        {t("tests.queuedSource")} {testRun.worktreeBranch ?? "detached"} · {testRun.worktreeHead.slice(0, 8)} · {new Date(testRun.queuedAt).toLocaleString(locale === "pl" ? "pl-PL" : "en-US")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={testRun.phase === "passed" ? "border-emerald-400/25 text-emerald-300" : testRun.phase === "failed" || testRun.phase === "timed_out" ? "border-red-400/25 text-red-300" : "text-muted-foreground"}>
                        {testRun.phase === "running" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Activity aria-hidden />}{t(`testPhase.${testRun.phase}`)}
                      </Badge>
                      {active ? <Button size="sm" variant="ghost" onClick={() => void cancel(testRun.id)}><Square aria-hidden />{t("tests.cancel")}</Button> : null}
                    </div>
                  </div>
                  <p className={`mt-2 text-xs ${testRun.source.attribution === "observed_match" ? "text-emerald-300" : "text-amber-300"}`}>
                    {t(`testSource.${testRun.source.attribution}`)}
                    {testRun.source.preflight?.head ? ` · ${t("tests.observedSource")} ${testRun.source.preflight.head.slice(0, 8)}` : ""}
                    {testRun.source.processOutcome === "passed" && testRun.phase !== "passed" ? ` · ${t("tests.commandPassedSourceUnverified")}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("testProfile.applied", { profile: testRun.environmentProfile })}
                    {testRun.inheritedServerProfile ? ` · ${t("testProfile.inherits", { profile: testRun.inheritedServerProfile })}` : ""}
                    {testRun.environmentVariableNames.length > 0 ? ` · ${testRun.environmentVariableNames.join(", ")}` : ""}
                  </p>
                  {testRun.queuePosition ? <p className="mt-2 text-xs text-muted-foreground">{t("tests.position", { position: testRun.queuePosition })}</p> : null}
                  {testRun.exitCode !== null ? <p className="mt-2 text-xs text-muted-foreground">{t("tests.exitCode", { code: testRun.exitCode })}</p> : null}
                  {testRun.error ? <p className="mt-2 text-xs text-destructive">{testRun.error}</p> : null}
                  {testRun.logs.length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("tests.output")}</summary>
                      <ScrollArea className="mt-2 h-32 rounded-md border bg-black/35 p-2">
                        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-zinc-300">{testRun.logs.join("\n")}</pre>
                      </ScrollArea>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
