"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/provider";
import type { TestQueueStatus } from "@/shared/contracts";
import { LoaderCircle, TestTube2 } from "lucide-react";
import { FormEvent, useState } from "react";

import type { Mutate } from "@/features/control-client";

export function TestQueueDialog({
  status,
  mutate,
  setError,
}: {
  status: TestQueueStatus;
  mutate: Mutate;
  setError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(String(status.limit));
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    try {
      await mutate("/api/settings/test-queue", { limit: Number(limit) }, t("tests.queueSaved"));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) setLimit(String(status.limit));
      setOpen(next);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label={t("tests.openSettings")}>
          <TestTube2 aria-hidden />{status.running}/{status.limit}
          {status.queued > 0 ? <Badge variant="secondary">+{status.queued}</Badge> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("tests.queueTitle")}</DialogTitle>
          <DialogDescription>{t("tests.queueDescription")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void save(event)}>
          <div className="space-y-2">
            <Label htmlFor="test-queue-limit">{t("tests.limit")}</Label>
            <Input id="test-queue-limit" type="number" min="1" max="16" value={limit} onChange={(event) => setLimit(event.target.value)} required />
          </div>
          <p className="rounded-lg border bg-black/15 p-3 text-sm">{t("tests.queueUsage", { running: status.running, queued: status.queued })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}{t("common.save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
