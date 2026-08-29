"use client";

import {
  Activity,
  AlertTriangle,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Sun,
  UnlockKeyhole,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DirectoryPicker } from "@/components/directory-picker";
import type { DashboardResponse, ProjectSnapshot, RuntimePhase } from "@/shared/contracts";

const phaseLabels: Record<RuntimePhase, string> = {
  stopped: "Zatrzymany",
  starting: "Uruchamianie",
  running: "Gotowy",
  stopping: "Zatrzymywanie",
  failed: "Błąd",
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Błąd HTTP ${response.status}`);
  return body;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse>({ projects: [] });
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch("/api/dashboard", {
        cache: "no-store",
        headers: { "X-Worktree-Switcher-Token": accessToken },
      });
      setData(await parseResponse<DashboardResponse>(response));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let events: EventSource | null = null;
    const initialRefresh = window.setTimeout(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get("token") ?? window.sessionStorage.getItem("worktree-switcher-token");
      if (!accessToken) {
        setLoading(false);
        setError("Brak klucza dostępu. Otwórz pełny link wyświetlony przez kontroler.");
        return;
      }
      window.sessionStorage.setItem("worktree-switcher-token", accessToken);
      if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setToken(accessToken);
      void refresh(accessToken);
      events = new EventSource(`/api/events?token=${encodeURIComponent(accessToken)}`);
      events.addEventListener("changed", () => void refresh(accessToken));
      events.onerror = () => setError("Utracono połączenie z kontrolerem. Trwa ponawianie…");
    }, 0);
    return () => {
      window.clearTimeout(initialRefresh);
      events?.close();
    };
  }, [refresh]);

  const mutate = useCallback(async (path: string, body: unknown, success: string) => {
    if (!token) throw new Error("Sesja kontrolera nie jest jeszcze gotowa.");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worktree-Switcher-Token": token },
      body: JSON.stringify(body),
    });
    await parseResponse(response);
    setNotice(success);
    setError(null);
    await refresh(token);
  }, [refresh, token]);

  const runningCount = useMemo(
    () => data.projects.filter(({ runtime }) => runtime.phase === "running").length,
    [data.projects],
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.26_0.06_260/.32),transparent_34rem)]">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 lg:px-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl border border-indigo-400/25 bg-indigo-400/10 shadow-[0_0_30px_oklch(0.65_0.15_270/.12)]">
              <GitBranch className="size-5 text-indigo-300" aria-hidden />
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Local control plane</p>
              <h1 className="text-2xl font-semibold tracking-tight">Worktree Switcher</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-9 gap-2 px-3 font-normal">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              {runningCount} aktywne · {data.projects.length} projektów
            </Badge>
            <ThemeToggle />
            <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} mutate={mutate} token={token} />
          </div>
        </header>

        <div className="sr-only" aria-live="polite">{error ?? notice}</div>
        {error && (
          <Alert variant="destructive" className="mb-5">
            <AlertTriangle aria-hidden />
            <AlertTitle>Nie udało się wykonać operacji</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="grid place-items-center py-28 text-muted-foreground">
            <LoaderCircle className="mb-3 size-6 animate-spin motion-reduce:animate-none" aria-hidden />
            Łączenie z kontrolerem…
          </div>
        ) : data.projects.length === 0 ? (
          <EmptyState onAdd={() => setDialogOpen(true)} />
        ) : (
          <section className="grid gap-5 xl:grid-cols-2" aria-label="Zarejestrowane projekty">
            {data.projects.map((snapshot) => (
              <ProjectCard key={snapshot.project.id} snapshot={snapshot} mutate={mutate} setError={setError} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function ProjectCard({
  snapshot,
  mutate,
  setError,
}: {
  snapshot: ProjectSnapshot;
  mutate: (path: string, body: unknown, success: string) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const { project, runtime, reservation, worktrees } = snapshot;
  const initial = project.selectedWorktreePath ?? worktrees[0]?.path ?? "";
  const [selected, setSelected] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const selectedWorktree = worktrees.find((worktree) => worktree.path === selected);
  const isBusy = runtime.phase === "starting" || runtime.phase === "stopping" || pending !== null;

  const act = async (operation: "start" | "stop" | "restart" | "switch") => {
    setPending(operation);
    try {
      await mutate(
        `/api/projects/${project.id}/operation`,
        { operation, worktreePath: selected || undefined },
        `${project.name}: operacja ${operation} zakończona.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const reserve = async (action: "acquire" | "release") => {
    setPending(action);
    try {
      await mutate(
        `/api/projects/${project.id}/reservation`,
        { action, worktreePath: selected || undefined },
        action === "acquire" ? `${project.name}: blokada założona.` : `${project.name}: blokada zdjęta.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="overflow-hidden border-white/8 bg-card/75 shadow-xl shadow-black/10 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="size-4 text-indigo-300" aria-hidden />
              {project.name}
            </CardTitle>
            <CardDescription className="mt-1 truncate font-mono text-xs" title={project.repositoryPath}>
              {project.repositoryPath}
            </CardDescription>
          </div>
          <RuntimeBadge phase={runtime.phase} />
        </div>
      </CardHeader>
      <CardContent>
        {snapshot.discoveryError && (
          <Alert variant="destructive" className="mb-4"><AlertTriangle aria-hidden /><AlertDescription>{snapshot.discoveryError}</AlertDescription></Alert>
        )}
        {reservation && (
          <Alert className="mb-4 border-amber-400/25 bg-amber-400/7 text-amber-100">
            <LockKeyhole aria-hidden />
            <AlertTitle>Zablokowany przez {reservation.owner}</AlertTitle>
            <AlertDescription className="truncate">Przypięty do {reservation.worktreePath}</AlertDescription>
          </Alert>
        )}
        {selectedWorktree?.dirty && (
          <Alert className="mb-4 border-amber-400/20 bg-amber-400/5 text-amber-100">
            <AlertTriangle aria-hidden />
            <AlertDescription>Ten worktree zawiera niezacommitowane zmiany. Uruchomienie jest dozwolone.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor={`worktree-${project.id}`}>Aktywny worktree</Label>
            <Select value={selected} onValueChange={setSelected} disabled={isBusy || worktrees.length === 0}>
              <SelectTrigger id={`worktree-${project.id}`} className="w-full">
                <SelectValue placeholder="Brak worktree" />
              </SelectTrigger>
              <SelectContent>
                {worktrees.map((worktree) => (
                  <SelectItem key={worktree.path} value={worktree.path} disabled={worktree.prunable}>
                    <span className="flex items-center gap-2">
                      {worktree.branch ?? "detached HEAD"}
                      <span className="font-mono text-xs text-muted-foreground">{worktree.shortHead}</span>
                      {worktree.dirty && <span className="text-amber-400">● dirty</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            {runtime.phase === "running" ? (
              <Button variant="outline" onClick={() => void act("stop")} disabled={isBusy}><Square aria-hidden />Stop</Button>
            ) : (
              <Button onClick={() => void act("start")} disabled={isBusy || !selected}><Play aria-hidden />Start</Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => void act("restart")} disabled={isBusy || !selected}>
                  <RotateCcw aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Uruchom ponownie</TooltipContent>
            </Tooltip>
            <Button variant="secondary" onClick={() => void act("switch")} disabled={isBusy || !selected || runtime.worktreePath === selected}>
              <RefreshCw aria-hidden />Przełącz
            </Button>
          </div>
        </div>

        <Separator className="my-5" />
        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="logs">Logi <span className="text-muted-foreground">{runtime.logs.length}</span></TabsTrigger>
          </TabsList>
          <TabsContent value="status" className="mt-4">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
              <Metric label="Port" value={String(project.port)} />
              <Metric label="PID" value={runtime.pid ? String(runtime.pid) : "—"} />
              <Metric label="Proces" value={`${project.executable} ${project.args.join(" ")}`} mono />
              <Metric label="Commit" value={selectedWorktree?.shortHead ?? "—"} mono />
              <Metric label="Gałąź" value={selectedWorktree?.branch ?? "detached"} />
              <Metric label="Uruchomiony" value={runtime.startedAt ? new Date(runtime.startedAt).toLocaleTimeString("pl-PL") : "—"} />
            </dl>
            {runtime.failure ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle aria-hidden />
                <AlertTitle>{runtime.failure.title}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{runtime.failure.message}</p>
                  <p><span className="font-medium">Co możesz zrobić:</span> {runtime.failure.suggestion}</p>
                  <details>
                    <summary className="cursor-pointer select-none text-xs">Szczegóły techniczne</summary>
                    <p className="mt-1 font-mono text-xs">{runtime.failure.technicalDetails}</p>
                  </details>
                </AlertDescription>
              </Alert>
            ) : runtime.error ? (
              <p className="mt-4 text-sm text-destructive">{runtime.error}</p>
            ) : null}
          </TabsContent>
          <TabsContent value="logs" className="mt-4">
            <ScrollArea className="h-40 rounded-md border bg-black/35 p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-zinc-300">
                {runtime.logs.length ? runtime.logs.join("\n") : "Brak logów dla bieżącej sesji."}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/7 pt-4">
          <p className="truncate text-xs text-muted-foreground" title={selectedWorktree?.path}>{selectedWorktree?.path ?? "Brak wyboru"}</p>
          {reservation ? (
            <Button size="sm" variant="ghost" onClick={() => void reserve("release")} disabled={isBusy}>
              <UnlockKeyhole aria-hidden />Zwolnij
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => void reserve("acquire")} disabled={isBusy || !selected}>
              <LockKeyhole aria-hidden />Zablokuj
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RuntimeBadge({ phase }: { phase: RuntimePhase }) {
  const active = phase === "running";
  const busy = phase === "starting" || phase === "stopping";
  return (
    <Badge variant="outline" className={active ? "border-emerald-400/25 text-emerald-300" : phase === "failed" ? "border-red-400/25 text-red-300" : "text-muted-foreground"}>
      {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Activity aria-hidden />}
      {phaseLabels[phase]}
    </Badge>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`truncate pt-0.5 ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</dd></div>;
}

function AddProjectDialog({ open, onOpenChange, mutate, token }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mutate: (path: string, body: unknown, success: string) => Promise<void>;
  token: string;
}) {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [repositoryPath, setRepositoryPath] = useState("");
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
      }, "Projekt został dodany.");
      setRepositoryPath("");
      onOpenChange(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button><Plus aria-hidden />Dodaj projekt</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Dodaj repozytorium</DialogTitle>
          <DialogDescription>Switcher wykryje wszystkie worktree i przypisze projektowi stały port.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2"><Label htmlFor="name">Nazwa</Label><Input id="name" name="name" placeholder="Frontend" required maxLength={80} /></div>
          <div className="space-y-2">
            <Label htmlFor="repositoryPath">Ścieżka repozytorium</Label>
            <DirectoryPicker token={token} value={repositoryPath} onChange={setRepositoryPath} />
          </div>
          <div className="space-y-2"><Label htmlFor="port">Port aplikacji</Label><Input id="port" name="port" type="number" defaultValue="3000" min="1024" max="65535" required /></div>
          <p className="text-xs text-muted-foreground">Komenda startowa i sposób przekazania portu zostaną wykryte z <code>package.json</code> oraz pliku blokady zależności.</p>
          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Anuluj</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden />}Dodaj</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="mx-auto max-w-2xl border-dashed bg-card/45 py-10 text-center">
      <CardContent className="grid justify-items-center">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-muted"><GitCommitHorizontal className="size-6 text-muted-foreground" aria-hidden /></div>
        <h2 className="text-xl font-semibold">Dodaj pierwszy projekt</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Wskaż lokalne repozytorium Git. Switcher znajdzie jego worktree i pozwoli przełączać serwer bez zmiany portu.</p>
        <Button className="mt-6" onClick={onAdd}><Plus aria-hidden />Dodaj repozytorium</Button>
      </CardContent>
    </Card>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("worktree-switcher-theme", next ? "dark" : "light");
  };
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = localStorage.getItem("worktree-switcher-theme");
      const next = saved !== "light";
      document.documentElement.classList.toggle("dark", next);
      setDark(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <Button variant="outline" size="icon" onClick={toggle} aria-label={dark ? "Włącz jasny motyw" : "Włącz ciemny motyw"}>{dark ? <Sun aria-hidden /> : <Moon aria-hidden />}</Button>;
}
