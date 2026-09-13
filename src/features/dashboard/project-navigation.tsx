"use client";

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/provider";
import { FlaskConical, GitBranch, HardDrive, ScrollText } from "lucide-react";

export type ProjectSection = "worktrees" | "tests" | "resources" | "logs";

export const projectSections = [
  { id: "worktrees", label: "dashboard.navWorktrees", icon: GitBranch },
  { id: "tests", label: "dashboard.navTests", icon: FlaskConical },
  { id: "resources", label: "dashboard.navResources", icon: HardDrive },
  { id: "logs", label: "project.logs", icon: ScrollText },
] as const;

export function ProjectNavigation({ section, onSelect, projectName }: {
  section: ProjectSection;
  onSelect: (section: ProjectSection) => void;
  projectName?: string;
}) {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" mobileTitle={t("dashboard.navigation")} mobileDescription={projectName ?? t("projectSwitcher.none")} closeLabel={t("common.close")}>
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-4 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-3 pr-6 text-primary">
          <GitBranch className="size-5 shrink-0" aria-hidden />
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">Worktree Switcher</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label={t("dashboard.navigation")}>
            <SidebarMenu>
              {projectSections.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={section === id && !!projectName}
                    aria-current={section === id && projectName ? "page" : undefined}
                    aria-label={t(label)}
                    tooltip={t(label)}
                    disabled={!projectName}
                    className="h-11 data-active:bg-sidebar-accent data-active:text-primary"
                    onClick={() => { onSelect(id); setOpenMobile(false); }}
                  >
                    <Icon aria-hidden /><span>{t(label)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:hidden">
        <p className="text-xs text-muted-foreground">{t("projectSwitcher.current")}</p>
        <p className="truncate text-sm" title={projectName}>{projectName ?? t("projectSwitcher.none")}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
