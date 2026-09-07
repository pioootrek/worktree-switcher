"use client";

import { EMPTY_RESOURCES } from "@/features/runtime/defaults";

import { parseResponse } from "@/features/control-client";
import { useI18n } from "@/i18n/provider";
import type { ControllerDashboardResponse, RuntimeMetricsResponse } from "@/shared/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EMPTY_CAPACITY, EMPTY_MCP_STATUS, EMPTY_TEST_QUEUE } from "./defaults";

export function useDashboard() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<ControllerDashboardResponse>({ projects: [], capacity: EMPTY_CAPACITY, testQueue: EMPTY_TEST_QUEUE, mcp: EMPTY_MCP_STATUS });
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch("/api/dashboard", {
        cache: "no-store",
        headers: { "Accept-Language": locale, "X-Worktree-Switcher-Token": accessToken },
      });
      const dashboard = await parseResponse<ControllerDashboardResponse>(response, t("http.error", { status: response.status }));
      setData({ ...dashboard, capacity: dashboard.capacity ?? EMPTY_CAPACITY, testQueue: dashboard.testQueue ?? EMPTY_TEST_QUEUE, mcp: dashboard.mcp ?? EMPTY_MCP_STATUS });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    let events: EventSource | null = null;
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
      void refresh(accessToken);
      events = new EventSource(`/api/events?token=${encodeURIComponent(accessToken)}`);
      events.addEventListener("changed", () => void refresh(accessToken));
      events.onerror = () => setError(t("dashboard.connectionLost"));
    }, 0);
    return () => {
      window.clearTimeout(initialRefresh);
      events?.close();
    };
  }, [refresh, t]);

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
    await refresh(token);
  }, [locale, refresh, t, token]);

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
    const poll = async () => {
      try {
        const response = await fetch("/api/metrics", {
          cache: "no-store",
          headers: { "X-Worktree-Switcher-Token": token },
        });
        const body = await parseResponse<RuntimeMetricsResponse>(response, t("http.error", { status: response.status }));
        if (cancelled) return;
        const metrics = new Map(body.projects.map(({ projectId, resources }) => [projectId, resources]));
        setData((current) => ({
          ...current,
          projects: current.projects.map((snapshot) => ({
            ...snapshot,
            runtime: { ...snapshot.runtime, resources: metrics.get(snapshot.project.id) ?? snapshot.runtime.resources ?? EMPTY_RESOURCES },
          })),
        }));
      } catch {
        // The dashboard/SSE connection owns the visible connection error state.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [monitoredProjectIds, t, token]);

  return { data, token, loading, error, notice, mutate, setError, runningCount };
}
