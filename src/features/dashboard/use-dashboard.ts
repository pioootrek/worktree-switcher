"use client";

import { EMPTY_RESOURCES } from "@/features/runtime/defaults";

import { parseResponse } from "@/features/control-client";
import { useI18n } from "@/i18n/provider";
import type {
  ControllerDashboardResponse,
  DashboardChangeEvent,
  DashboardLiveResponse,
  DashboardSection,
  RuntimeMetricsResponse,
  RuntimeResourceMetrics,
} from "@/shared/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_CAPACITY, EMPTY_MCP_STATUS, EMPTY_TEST_QUEUE } from "./defaults";

interface PendingRefresh {
  bootstrap: boolean;
  projectIds: Set<string>;
  sections: Set<DashboardSection>;
}

const emptyPending = (): PendingRefresh => ({ bootstrap: false, projectIds: new Set(), sections: new Set() });

function newestResources(current: RuntimeResourceMetrics, incoming: RuntimeResourceMetrics): RuntimeResourceMetrics {
  if (!current.sampledAt) return incoming;
  if (!incoming.sampledAt) return current;
  return incoming.sampledAt >= current.sampledAt ? incoming : current;
}

export function useDashboard() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<ControllerDashboardResponse>({ projects: [], capacity: EMPTY_CAPACITY, testQueue: EMPTY_TEST_QUEUE, mcp: EMPTY_MCP_STATUS });
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef<PendingRefresh>(emptyPending());
  const inFlight = useRef<Promise<void> | null>(null);
  const requestAbort = useRef<AbortController | null>(null);

  const reconcile = useCallback((accessToken: string, request: { bootstrap?: boolean; projectIds?: string[]; sections?: DashboardSection[] } = {}) => {
    if (request.bootstrap) pending.current.bootstrap = true;
    for (const id of request.projectIds ?? []) pending.current.projectIds.add(id);
    for (const section of request.sections ?? []) pending.current.sections.add(section);
    if (inFlight.current) return inFlight.current;
    const activeGeneration = generation.current;
    const operation = (async () => {
      while (pending.current.bootstrap || pending.current.sections.size > 0) {
        const next = pending.current;
        pending.current = emptyPending();
        const controller = new AbortController();
        requestAbort.current = controller;
        try {
          if (next.bootstrap) {
            const response = await fetch("/api/dashboard", {
              cache: "no-store",
              signal: controller.signal,
              headers: { "Accept-Language": locale, "X-Worktree-Switcher-Token": accessToken },
            });
            const dashboard = await parseResponse<ControllerDashboardResponse>(response, t("http.error", { status: response.status }));
            if (generation.current !== activeGeneration) return;
            setData((current) => {
              const resources = new Map(current.projects.map((project) => [project.project.id, project.runtime.resources]));
              return {
                ...dashboard,
                capacity: dashboard.capacity ?? EMPTY_CAPACITY,
                testQueue: dashboard.testQueue ?? EMPTY_TEST_QUEUE,
                mcp: dashboard.mcp ?? EMPTY_MCP_STATUS,
                projects: dashboard.projects.map((project) => ({
                  ...project,
                  runtime: {
                    ...project.runtime,
                    resources: newestResources(resources.get(project.project.id) ?? EMPTY_RESOURCES, project.runtime.resources ?? EMPTY_RESOURCES),
                  },
                })),
              };
            });
          } else {
            const query = new URLSearchParams();
            for (const projectId of next.projectIds) query.append("project", projectId);
            for (const section of next.sections) query.append("section", section);
            const response = await fetch(`/api/dashboard/live?${query}`, {
              cache: "no-store",
              signal: controller.signal,
              headers: { "Accept-Language": locale, "X-Worktree-Switcher-Token": accessToken },
            });
            const live = await parseResponse<DashboardLiveResponse>(response, t("http.error", { status: response.status }));
            if (generation.current !== activeGeneration) return;
            const updates = new Map(live.projects.map((project) => [project.projectId, project]));
            setData((current) => ({
              ...current,
              capacity: live.capacity ?? current.capacity,
              testQueue: live.testQueue ?? current.testQueue,
              projects: current.projects.map((snapshot) => {
                const update = updates.get(snapshot.project.id);
                if (!update) return snapshot;
                return {
                  ...snapshot,
                  runtime: update.runtime ? {
                    ...update.runtime,
                    resources: newestResources(snapshot.runtime.resources ?? EMPTY_RESOURCES, update.runtime.resources ?? EMPTY_RESOURCES),
                  } : snapshot.runtime,
                  reservation: update.reservation !== undefined ? update.reservation : snapshot.reservation,
                  storage: update.storage ?? snapshot.storage,
                  testRuns: update.testRuns ?? snapshot.testRuns,
                };
              }),
            }));
          }
          setError(null);
        } catch (cause) {
          if (generation.current === activeGeneration && !(cause instanceof DOMException && cause.name === "AbortError")) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        } finally {
          if (generation.current === activeGeneration) setLoading(false);
          if (requestAbort.current === controller) requestAbort.current = null;
        }
      }
    })().finally(() => {
      if (inFlight.current === operation) inFlight.current = null;
    });
    inFlight.current = operation;
    return operation;
  }, [locale, t]);

  useEffect(() => {
    generation.current += 1;
    let events: EventSource | null = null;
    let readyCount = 0;
    let focusHandler: (() => void) | null = null;
    const initialRefresh = window.setTimeout(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get("token") ?? window.sessionStorage.getItem("worktree-switcher-token");
      if (!accessToken) {
        setLoading(false);
        setError(t("dashboard.missingToken"));
        return;
      }
      window.sessionStorage.setItem("worktree-switcher-token", accessToken);
      if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setToken(accessToken);
      void reconcile(accessToken, { bootstrap: true });
      events = new EventSource(`/api/events?token=${encodeURIComponent(accessToken)}`);
      events.addEventListener("ready", () => {
        readyCount += 1;
        if (readyCount > 1) void reconcile(accessToken, { bootstrap: true });
      });
      events.addEventListener("changed", (message) => {
        try {
          const change = JSON.parse((message as MessageEvent<string>).data) as DashboardChangeEvent;
          if (change.kinds.includes("topology") || change.kinds.includes("metadata")) {
            void reconcile(accessToken, { bootstrap: true });
            return;
          }
          const sections = change.kinds.filter((kind): kind is DashboardSection =>
            ["runtime", "reservation", "tests", "storage", "controller"].includes(kind),
          );
          void reconcile(accessToken, { projectIds: change.allProjects ? [] : change.projectIds, sections });
        } catch {
          void reconcile(accessToken, { bootstrap: true });
        }
      });
      events.onerror = () => setError(t("dashboard.connectionLost"));
      focusHandler = () => void reconcile(accessToken, { bootstrap: true });
      window.addEventListener("focus", focusHandler);
    }, 0);
    return () => {
      generation.current += 1;
      window.clearTimeout(initialRefresh);
      requestAbort.current?.abort();
      requestAbort.current = null;
      pending.current = emptyPending();
      inFlight.current = null;
      events?.close();
      if (focusHandler) window.removeEventListener("focus", focusHandler);
    };
  }, [reconcile, t]);

  const mutate = useCallback(async (path: string, body: unknown, success: string, method: "POST" | "DELETE" = "POST") => {
    if (!token) throw new Error(t("dashboard.sessionPending"));
    const response = await fetch(path, {
      method,
      headers: { "Accept-Language": locale, "Content-Type": "application/json", "X-Worktree-Switcher-Token": token },
      body: JSON.stringify(body),
    });
    await parseResponse(response, t("http.error", { status: response.status }));
    setNotice(success);
    setError(null);
    await reconcile(token, { bootstrap: true });
  }, [locale, reconcile, t, token]);

  const runningCount = useMemo(
    () => data.projects.filter(({ runtime }) => runtime.phase === "running").length,
    [data.projects],
  );
  const monitoredProjectIds = useMemo(
    () => data.projects.filter(({ runtime }) => runtime.phase === "running" || runtime.phase === "starting").map(({ project }) => project.id).join(","),
    [data.projects],
  );

  useEffect(() => {
    if (!token || !monitoredProjectIds) return;
    let cancelled = false;
    let polling = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (polling) return;
      polling = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/metrics", {
          cache: "no-store",
          signal: controller.signal,
          headers: { "X-Worktree-Switcher-Token": token },
        });
        const body = await parseResponse<RuntimeMetricsResponse>(response, t("http.error", { status: response.status }));
        if (cancelled) return;
        const metrics = new Map(body.projects.map(({ projectId, resources }) => [projectId, resources]));
        setData((current) => ({
          ...current,
          projects: current.projects.map((snapshot) => ({
            ...snapshot,
            runtime: {
              ...snapshot.runtime,
              resources: newestResources(snapshot.runtime.resources ?? EMPTY_RESOURCES, metrics.get(snapshot.project.id) ?? snapshot.runtime.resources ?? EMPTY_RESOURCES),
            },
          })),
        }));
      } catch {
        // The dashboard/SSE connection owns the visible connection error state.
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [monitoredProjectIds, t, token]);

  return { data, token, loading, error, notice, mutate, setError, runningCount };
}
