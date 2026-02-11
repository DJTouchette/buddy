import type React from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { StatsPage } from "./pages/StatsPage";
import { TicketsPage } from "./pages/TicketsPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { PRsPage } from "./pages/PRsPage";
import { PRDetailPage } from "./pages/PRDetailPage";
import { CreatePRPage } from "./pages/CreatePRPage";
import { GitPage } from "./pages/GitPage";
import { InfraPage } from "./pages/InfraPage";
import { AppSyncPage } from "./pages/AppSyncPage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CTestPage } from "./pages/CTestPage";

interface Route {
  path: string;
  component: React.ComponentType<any>;
  paramPattern?: RegExp;
  paramName?: string;
}

const routes: Route[] = [
  { path: "/", component: DashboardPage },
  { path: "/dashboard", component: DashboardPage },
  { path: "/stats", component: StatsPage },
  { path: "/tickets", component: TicketsPage },
  { path: "/tickets/:key", component: TicketDetailPage, paramPattern: /^\/tickets\/([A-Z]+-\d+)$/i, paramName: "ticketKey" },
  { path: "/prs", component: PRsPage },
  { path: "/prs/create", component: CreatePRPage },
  { path: "/prs/:id", component: PRDetailPage, paramPattern: /^\/prs\/(\d+)$/, paramName: "prId" },
  { path: "/git", component: GitPage },
  { path: "/infra", component: InfraPage },
  { path: "/appsync", component: AppSyncPage },
  { path: "/jobs", component: JobsPage },
  { path: "/ctest", component: CTestPage },
  { path: "/settings", component: SettingsPage },
];

interface MatchResult {
  component: React.ComponentType<any>;
  params: Record<string, string>;
}

export function matchRoute(currentPath: string): MatchResult {
  // Check parameterized routes first (order matters - /prs/create before /prs/:id)
  for (const route of routes) {
    if (route.paramPattern) {
      const match = currentPath.match(route.paramPattern);
      if (match && route.paramName) {
        return {
          component: route.component,
          params: { [route.paramName]: match[1] },
        };
      }
    } else if (route.path === currentPath) {
      return {
        component: route.component,
        params: {},
      };
    }
  }

  // Default to dashboard
  return { component: DashboardPage, params: {} };
}
