"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CertificateFilePicker } from "@/features/runtime/certificate-file-picker";
import { useI18n } from "@/i18n/provider";
import type { DevServerTlsMode, ProjectView, RuntimePhase } from "@/shared/contracts";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

import type { Mutate } from "@/features/control-client";

export function TlsSettingsDialog({
  project,
  phase,
  token,
  mutate,
  setError,
}: {
  project: ProjectView;
  phase: RuntimePhase;
  token: string;
  mutate: Mutate;
  setError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DevServerTlsMode>(project.tlsMode);
  const [keyPath, setKeyPath] = useState(project.tlsKeyPath ?? "");
  const [certPath, setCertPath] = useState(project.tlsCertPath ?? "");
  const [caPath, setCaPath] = useState(project.tlsCaPath ?? "");
  const [pending, setPending] = useState(false);
  const active = phase === "running" || phase === "starting" || phase === "stopping";

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await mutate(
        `/api/projects/${project.id}/tls`,
        { mode, keyPath: keyPath || null, certPath: certPath || null, caPath: caPath || null },
        t("tls.saved", { name: project.name }),
      );
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={t("tls.settings")} title={t("tls.settings")}>
          <ShieldCheck aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("tls.title")}</DialogTitle>
          <DialogDescription>
            {t("tls.description", { name: project.name })}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <div className="space-y-2">
            <Label htmlFor={`tls-mode-${project.id}`}>{t("tls.mode")}</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as DevServerTlsMode)}>
              <SelectTrigger id={`tls-mode-${project.id}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t("tls.off")}</SelectItem>
                <SelectItem value="generated">{t("tls.generated")}</SelectItem>
                <SelectItem value="custom">{t("tls.custom")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "generated" && (
            <Alert>
              <ShieldCheck aria-hidden />
              <AlertDescription>{t("tls.generatedHint")}</AlertDescription>
            </Alert>
          )}

          {mode === "custom" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`tls-key-${project.id}`}>{t("tls.privateKey")}</Label>
                <CertificateFilePicker id={`tls-key-${project.id}`} token={token} value={keyPath} onChange={setKeyPath} placeholder="/home/me/certs/dev-key.pem" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`tls-cert-${project.id}`}>{t("tls.certificate")}</Label>
                <CertificateFilePicker id={`tls-cert-${project.id}`} token={token} value={certPath} onChange={setCertPath} placeholder="/home/me/certs/dev-cert.pem" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`tls-ca-${project.id}`}>{t("tls.optionalCa")}</Label>
                <CertificateFilePicker id={`tls-ca-${project.id}`} token={token} value={caPath} onChange={setCaPath} placeholder="/home/me/certs/root-ca.pem" />
              </div>
              <p className="text-xs text-muted-foreground">{t("tls.filesHint")}</p>
            </div>
          )}

          {active && <p className="text-sm text-amber-300">{t("tls.stopBeforeSave")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={active || pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden />}{t("common.save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
